import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "../../core/types";
import { atomicWrite } from "../../util/atomic";
import { canonicalExistingPath } from "../../util/canonical-path";
import type { ToolContext } from "../types";
import { prepareScratch } from "../util/scratch";

type Target = { host: string; port: number; user?: string | undefined };
type Prepared =
  | { ok: true; context: ToolContext; arguments: string[] }
  | (ToolResult & { ok: false });
export type SshCapabilityDependencies = {
  agentSocket?: string;
  knownHostsFile?: string;
  sshAdd?: string;
  sshKeygen?: string;
};

async function resolveAgentSocket(path: string): Promise<string | undefined> {
  const canonical = canonicalExistingPath(path);
  return (await stat(canonical)).isSocket() ? canonical : undefined;
}

async function probe(
  command: string[],
  signal: AbortSignal,
  env?: Record<string, string>,
): Promise<{ code: number; text: string }> {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => child.kill("SIGKILL");
  const timer = setTimeout(abort, 5000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > 512 * 1024) {
        abort();
        throw new Error("SSH preflight output exceeded its limit");
      }
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  };
  try {
    const [code, text] = await Promise.all([
      child.exited,
      collect(child.stdout),
      collect(child.stderr),
    ]);
    signal.throwIfAborted();
    return { code, text };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    abort();
  }
}

/** Forward a live agent socket and the selected host's public keys, never private keys or ~/.ssh. */
export async function prepareSshCapability(
  target: Target,
  context: ToolContext,
  dependencies: SshCapabilityDependencies = {},
): Promise<Prepared> {
  const failure = (code: string, message: string): Prepared => ({
    ok: false,
    output: "",
    error: message,
    data: { kind: "remote_capability", code, host: target.host, port: target.port },
  });
  const requestedSocket = dependencies.agentSocket ?? process.env.SSH_AUTH_SOCK;
  const socket = requestedSocket
    ? await resolveAgentSocket(requestedSocket).catch(() => undefined)
    : undefined;
  if (!socket)
    return failure(
      "auth_unavailable",
      "No live SSH agent socket is available to the app. Unlock the SSH agent before submitting a remote job.",
    );
  const add = dependencies.sshAdd ?? Bun.which("ssh-add");
  const keygen = dependencies.sshKeygen ?? Bun.which("ssh-keygen");
  if (!add || !keygen)
    return failure(
      "remote_environment_unavailable",
      "SSH agent and host-key preflight tools are unavailable.",
    );
  try {
    const identities = await probe([add, "-l"], context.signal, { SSH_AUTH_SOCK: socket });
    if (identities.code !== 0)
      return failure("auth_unavailable", "The SSH agent has no usable unlocked identities.");
    const source = dependencies.knownHostsFile ?? join(homedir(), ".ssh", "known_hosts");
    const sourceInfo = await stat(source).catch(() => undefined);
    if (!sourceInfo?.isFile() || sourceInfo.size > 16 * 1024 * 1024)
      return failure(
        "host_key_unavailable",
        "A bounded trusted known_hosts store is required for remote execution.",
      );
    const lookup = target.port === 22 ? target.host : `[${target.host}]:${target.port}`;
    const keys = await probe([keygen, "-F", lookup, "-f", source], context.signal);
    if (keys.code !== 0 || !keys.text.trim())
      return failure(
        "host_key_unavailable",
        "This host and port have no trusted SSH host key. Establish host trust in your SSH client before submitting the job.",
      );
    const scratch = context.scratchDir ?? join(context.cwd, ".flecten-scratch", context.sessionId);
    await prepareScratch(scratch);
    const knownHosts = join(
      context.cwd,
      ".flecten",
      "sessions",
      context.approvalSessionId ?? context.sessionId,
      "ssh-known-hosts",
      `known-hosts-${new Bun.CryptoHasher("sha256").update(lookup).digest("hex").slice(0, 16)}`,
    );
    await atomicWrite(knownHosts, keys.text, 0o600, context.signal);
    const forward = (boundary: ReturnType<NonNullable<ToolContext["security"]>>) => ({
      ...boundary,
      ...(boundary.osSandbox
        ? {
            osSandbox: {
              ...boundary.osSandbox,
              envAllowlist: [...new Set([...boundary.osSandbox.envAllowlist, "SSH_AUTH_SOCK"])],
              readOnlyPaths: [
                ...new Set([...(boundary.osSandbox.readOnlyPaths ?? []), socket, knownHosts]),
              ],
            },
          }
        : {}),
    });
    return {
      ok: true,
      context: {
        ...context,
        scratchDir: scratch,
        env: { ...context.env, SSH_AUTH_SOCK: socket },
        ...forward({ sandbox: context.sandbox, osSandbox: context.osSandbox }),
        security: () =>
          forward(
            context.security?.() ?? { sandbox: context.sandbox, osSandbox: context.osSandbox },
          ),
      },
      arguments: [
        "-F",
        "/dev/null",
        "-o",
        "ForwardAgent=no",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${knownHosts}`,
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "IdentityFile=none",
      ],
    };
  } catch (error) {
    context.signal.throwIfAborted();
    return failure(
      "remote_environment_unavailable",
      error instanceof Error ? error.message : "SSH environment preflight failed",
    );
  }
}
