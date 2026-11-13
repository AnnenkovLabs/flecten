import { HOOK_NAMES } from "../../../shared/hooks";
import { createHookRunner } from "../hooks/runner";
import type { HookInput, HookName, HooksConfig } from "../hooks/types";
import type { ModuleSessionPort } from "../modules/types";
import type { Event } from "../types";

export function sessionHookRunner(
  config: HooksConfig | undefined,
  sessionId: string,
  cwd: string,
  emit: (event: Event) => void,
  modules?: ModuleSessionPort,
) {
  const report = (hook: Extract<Event, { type: "hook.finished" }>["hook"]) =>
    emit({ type: "hook.finished", sessionId, hook });
  const runner =
    config || modules
      ? createHookRunner(
          () => {
            const active = modules?.hooks(sessionId);
            return Object.fromEntries(
              HOOK_NAMES.map((event) => [
                event,
                [
                  ...(config?.[event] ?? []).map((hook) => ({
                    ...hook,
                    source: { type: "project" as const },
                  })),
                  ...(active?.[event] ?? []),
                ],
              ]),
            );
          },
          { onRun: report },
        )
      : undefined;
  return {
    runner,
    async run(event: HookName, input: Omit<HookInput, "sessionId" | "cwd">, signal: AbortSignal) {
      const outcome = await runner?.run(event, { sessionId, cwd, ...input }, signal);
      for (const hook of outcome?.runs ?? []) report(hook);
      return outcome;
    },
  };
}

/** A job can finish while its session is idle, so notifications have their own hook runner. */
export function notifyJobHook(
  config: HooksConfig | undefined,
  cwd: string,
  event: Event,
  emit: (event: Event) => void,
  modules?: ModuleSessionPort,
): void {
  if (
    event.type !== "job.finished" ||
    !event.notify ||
    (!config?.notification?.length && !modules?.hooks(event.sessionId).notification?.length)
  )
    return;
  const hooks = sessionHookRunner(config, event.sessionId, cwd, emit, modules);
  void hooks.run(
    "notification",
    {
      notification: {
        level: event.job.status === "failed" ? "error" : "info",
        message: `Background job ${event.job.id}: ${event.job.status}`,
        code: "job.finished",
      },
    },
    new AbortController().signal,
  );
}
