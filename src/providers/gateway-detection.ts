import type { ProviderGatewayInspection as GatewayInspection } from "../../shared/provider-protection";
import { abortable } from "../util/abort";
import {
  classifyGateway,
  gatewayAsset,
  gatewayBranding,
  gatewayHeaders,
  gatewayStatus,
} from "./gateway-signals";

interface GatewayDetectionOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

interface Probe {
  url: URL;
  kind: "status" | "page" | "asset";
}

const maximumBytes = 128 * 1024;
const deadlineMs = 4000;

function probes(baseUrl: string): Probe[] {
  const base = new URL(baseUrl);
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.username || base.password) {
    throw new Error("Gateway inspection requires an HTTP URL without embedded credentials.");
  }
  base.search = "";
  base.hash = "";
  const segments = base.pathname.split("/").filter(Boolean);
  if (segments.at(-1) === "v1" || segments.at(-1) === "v1beta") segments.pop();
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  const paths: Array<[string, Probe["kind"]]> = [
    [`${prefix}/api/status`, "status"],
    [`${prefix}/`, "page"],
    [`${prefix}/favicon.ico`, "asset"],
    [`${prefix}/logo.png`, "asset"],
  ];
  if (prefix) paths.push(["/api/status", "status"], ["/", "page"]);
  return paths.map(([path, kind]) => {
    const url = new URL(base.origin);
    url.pathname = path;
    return { url, kind };
  });
}

async function readBounded(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximumBytes) throw new Error("Gateway probe body limit exceeded.");
      chunks.push(chunk.value);
    }
  } finally {
    // A hostile response must not make cancellation wait for its stream source.
    void reader.cancel().catch(() => undefined);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function inspectProviderGateway(
  baseUrl: string,
  options: GatewayDetectionOptions = {},
): Promise<GatewayInspection> {
  const checkedAt = new Date().toISOString();
  const evidence: GatewayInspection["evidence"] = [];
  let targets: Probe[];
  try {
    targets = probes(baseUrl);
  } catch {
    return {
      gateway: "unknown",
      confidence: "unknown",
      evidence: [
        {
          id: "probe.invalid-url",
          source: "configuration",
          detail: "Enter an HTTP URL without embedded credentials to inspect the provider.",
        },
      ],
      checkedAt,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Gateway inspection timed out.")),
    deadlineMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const request = options.fetch ?? fetch;
  try {
    const results = await Promise.all(
      targets.map(async (target) => {
        const source = target.url.href.slice(0, 2048);
        const found: GatewayInspection["evidence"] = [];
        try {
          signal.throwIfAborted();
          const response = await abortable(
            request(target.url, {
              method: "GET",
              redirect: "manual",
              credentials: "omit",
              referrerPolicy: "no-referrer",
              headers: {
                Accept:
                  target.kind === "status"
                    ? "application/json"
                    : target.kind === "page"
                      ? "text/html"
                      : "image/*",
              },
              signal,
            }),
            signal,
          );
          if (
            response.redirected ||
            (response.url && new URL(response.url).origin !== target.url.origin)
          ) {
            void response.body?.cancel().catch(() => undefined);
            return [
              {
                id: "probe.cross-origin",
                source,
                detail: "A response from another origin was ignored.",
              },
            ];
          }
          found.push(...gatewayHeaders(response.headers, source));
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            found.push({
              id:
                response.status >= 300 && response.status < 400
                  ? "probe.redirect"
                  : "probe.http-error",
              source,
              detail:
                "The public probe did not return a successful response. Redirects are never followed.",
            });
            return found;
          }
          const bytes = await readBounded(response, signal);
          if (target.kind === "status") found.push(...gatewayStatus(bytes, source));
          else if (target.kind === "page") found.push(...gatewayBranding(bytes, source));
          else found.push(...gatewayAsset(bytes, source));
        } catch {
          found.push({
            id: signal.aborted ? "probe.cancelled" : "probe.unavailable",
            source,
            detail:
              "The bounded public probe could not complete. No claim about the backend can be made from this failure.",
          });
        }
        return found;
      }),
    );
    for (const result of results) evidence.push(...result);
    return { ...classifyGateway(evidence), evidence, checkedAt };
  } finally {
    clearTimeout(timer);
  }
}
