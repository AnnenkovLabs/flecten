import { ContextReferencesSchema } from "../core/context-reference";
import type { RoutedCommand } from "../core/types";
import { isReasoningEffort } from "../core/types";
import { isObject } from "../util/json";
import { type CommandInput, flag, optionalId, required, strings, text } from "./server-input";
import type { AppService } from "./service";

export type Reply = Record<string, unknown> | undefined;
export type Handler = (command: CommandInput) => Reply | Promise<Reply>;

export const SESSION_COMMANDS = [
  "approval.allowAll",
  "approval.denyAll",
  "approval.respond",
  "checkpoint.diff",
  "checkpoint.list",
  "checkpoint.restore",
  "context.compact",
  "events.replay",
  "jobs.list",
  "jobs.stop",
  "queue.add",
  "queue.edit",
  "queue.remove",
  "run",
  "steer",
  "stop",
  "tool.cancel",
  "subagent.stop",
] as const;
export type SessionCommandType = (typeof SESSION_COMMANDS)[number];

/**
 * Commands of one task: each names its session (`sessionId`) or goes to the focused one,
 * so a window can stop, steer or approve a task while another task runs.
 */
export type RunErrorReporter = (
  message: string,
  context: { sessionId?: string; clientId?: string },
) => void;

export function sessionHandlers(
  app: AppService,
  onRunError: RunErrorReporter,
): Record<SessionCommandType, Handler> {
  const call = (input: CommandInput, command: RoutedCommand): Promise<unknown> => {
    const sessionId = optionalId(input, "sessionId");
    return app.session.send({ ...command, ...(sessionId ? { sessionId } : {}) } as RoutedCommand);
  };
  const send = async (input: CommandInput, command: RoutedCommand): Promise<Reply> => {
    const result = await call(input, command);
    return {
      result,
      state: await call(input, { type: "status" }),
      ...(command.type === "approval.respond" ? { approval: result } : {}),
    };
  };
  const queue = (input: CommandInput, mode: "steer" | "queue"): Promise<Reply> => {
    const attachments = strings(input.attachments);
    const contexts = ContextReferencesSchema.parse(input.contexts ?? []);
    const id = optionalId(input, "id");
    return send(input, {
      type: "queue.add",
      text: text(input, "text"),
      mode,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(contexts.length > 0 ? { contexts } : {}),
      ...(id ? { id } : {}),
    });
  };
  const ids = (input: CommandInput): string[] => {
    const list = strings(input.ids);
    if (list.length === 0) throw new Error("ids are required");
    return list;
  };

  return {
    stop: (input) => {
      const mode = input.mode;
      if (mode !== undefined && mode !== "graceful" && mode !== "force")
        throw new Error("invalid stop mode");
      if (input.target !== undefined && input.target !== "worker")
        throw new Error("invalid stop target");
      return send(input, {
        type: "stop",
        ...(mode ? { mode } : {}),
        ...(input.target === "worker" ? { target: "worker" as const } : {}),
      });
    },
    steer: (input) => queue(input, "steer"),
    "queue.add": (input) => queue(input, "queue"),
    "queue.edit": (input) => {
      if (typeof input.text !== "string") throw new Error("id and text are required");
      return send(input, { type: "queue.edit", id: required(input, "id"), text: input.text });
    },
    "queue.remove": (input) => send(input, { type: "queue.remove", id: required(input, "id") }),
    "approval.respond": (input) => {
      const decision = input.decision;
      if (
        decision !== "allow_once" &&
        decision !== "allow_session" &&
        decision !== "allow_always" &&
        decision !== "deny"
      ) {
        throw new Error("invalid approval decision");
      }
      if (
        input.feedback !== undefined &&
        (typeof input.feedback !== "string" || input.feedback.length > 10000)
      )
        throw new Error("feedback must be a string up to 10000 characters");
      return send(input, {
        type: "approval.respond",
        id: required(input, "id"),
        decision,
        ...(typeof input.feedback === "string" ? { feedback: input.feedback } : {}),
      });
    },
    "approval.allowAll": (input) => send(input, { type: "approval.allowAll", ids: ids(input) }),
    "approval.denyAll": (input) => send(input, { type: "approval.denyAll", ids: ids(input) }),
    "checkpoint.list": async (input) => ({
      checkpoints: (await call(input, { type: "checkpoint.list" })) ?? [],
    }),
    "checkpoint.diff": async (input) => ({
      diff: await call(input, { type: "checkpoint.diff", id: required(input, "id") }),
    }),
    "checkpoint.restore": async (input) => {
      const target =
        input.target === "before" || input.target === "after" ? input.target : undefined;
      const paths = strings(input.paths);
      const restore = await call(input, {
        type: "checkpoint.restore",
        id: required(input, "id"),
        ...(target ? { target } : {}),
        ...(flag(input, "force") ? { force: true } : {}),
        ...(flag(input, "includeProtected") ? { includeProtected: true } : {}),
        ...(paths.length > 0 ? { paths } : {}),
      });
      return { restore };
    },
    "context.compact": async (input) => {
      const focus = typeof input.focus === "string" ? input.focus.trim().slice(0, 2000) : "";
      const result = await call(input, { type: "context.compact", ...(focus ? { focus } : {}) });
      return isObject(result) ? { ...result } : {};
    },
    "tool.cancel": (input) =>
      send(input, { type: "tool.cancel", callId: required(input, "callId") }),
    "subagent.stop": (input) => send(input, { type: "subagent.stop", id: required(input, "id") }),
    "jobs.list": async (input) => {
      const result = await call(input, { type: "jobs.list" });
      return isObject(result) ? { ...result } : { jobs: [] };
    },
    "jobs.stop": async (input) => {
      const result = await call(input, { type: "jobs.stop", id: required(input, "id") });
      return isObject(result) ? { ...result } : { job: null };
    },
    "events.replay": (input) => {
      const sessionId = optionalId(input, "sessionId");
      if (!sessionId) throw new Error("sessionId is required");
      return { replay: app.session.replay(sessionId) };
    },
    run: (input) => {
      const prompt = text(input, "prompt");
      const reasoning = input.reasoning;
      if (reasoning !== undefined && !isReasoningEffort(reasoning)) {
        throw new Error("reasoning is invalid");
      }
      const sessionId = optionalId(input, "sessionId");
      const clientId = optionalId(input, "clientId");
      const attachments = strings(input.attachments);
      const contexts = ContextReferencesSchema.parse(input.contexts ?? []);
      void app.session
        .send({
          type: "run",
          prompt,
          ...(reasoning ? { reasoning } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(clientId ? { clientId } : {}),
          ...(flag(input, "resumed") ? { resumed: true } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(contexts.length > 0 ? { contexts } : {}),
        })
        .catch((error: unknown) =>
          onRunError(error instanceof Error ? error.message : String(error), {
            ...(sessionId ? { sessionId } : {}),
            ...(clientId ? { clientId } : {}),
          }),
        );
      return undefined;
    },
  };
}
