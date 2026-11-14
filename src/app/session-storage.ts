import { z } from "zod";
import { harnessServices } from "../core/services/contracts";
import type { Services } from "../core/services/registry";
import type {
  EventEnvelope,
  ForkSessionOptions,
  SessionListOptions,
  StorageRequest,
} from "../core/services/storage";
import type { Event } from "../core/types";
import { envelopeSchema, readTolerant } from "../store/events/envelope";
import {
  assertSessionId,
  deleteSession,
  forkSession,
  listSessions,
  renameSession,
  summarySchema,
} from "../store/events/index";
import { eventSchema } from "../store/events/read";
import { sessionPaths } from "../store/paths";
import { redactSecrets } from "./provider-secrets";
import { SessionLogs } from "./session-logs";

/** Every product read/write uses the same backend, including replay and recovery. */
export class SessionStorage {
  readonly logs: SessionLogs;
  constructor(
    readonly cwd: string,
    readonly secrets: () => readonly string[],
    readonly services: () => Services,
    readonly prepare: () => Promise<void>,
  ) {
    this.logs = new SessionLogs(cwd, secrets);
  }
  readonly #local = async (request: StorageRequest): Promise<unknown> => {
    switch (request.operation) {
      case "append":
        await this.logs.persist(request.event);
        return null;
      case "read":
        return (await readTolerant(sessionPaths(this.cwd, request.sessionId).events)).envelopes;
      case "list":
        return listSessions(this.cwd, request.options);
      case "rename":
        return renameSession(this.cwd, request.sessionId, request.title);
      case "delete":
        return deleteSession(this.cwd, request.sessionId);
      case "fork":
        return forkSession(this.cwd, request.sessionId, request.options);
    }
  };
  async #call<T>(request: StorageRequest, schema: z.ZodType<T>): Promise<T> {
    await this.prepare();
    if ("sessionId" in request) assertSessionId(request.sessionId);
    const services = this.services();
    if (!services.has(harnessServices.storage)) return (await this.#local(request)) as T;
    const result = await services.invoke(harnessServices.storage, this.#local, request);
    return schema.parse(result);
  }
  async persist(event: Event): Promise<void> {
    const safe = JSON.parse(redactSecrets(JSON.stringify(event), this.secrets())) as Event;
    await this.#call({ operation: "append", event: safe }, z.null());
  }
  async envelopes(sessionId: string): Promise<EventEnvelope[]> {
    const value = await this.#call(
      { operation: "read", sessionId },
      z.array(
        envelopeSchema.extend({
          schemaVersion: z.number().int().nonnegative(),
          event: eventSchema,
        }),
      ),
    );
    let sequence = -1;
    for (const item of value) {
      if (item.sessionId !== sessionId || item.seq <= sequence)
        throw new Error("Storage returned an invalid journal order or session");
      sequence = item.seq;
    }
    return value as EventEnvelope[];
  }
  async read(sessionId: string): Promise<(Event & { timestamp?: number })[]> {
    return (await this.envelopes(sessionId)).flatMap(({ event, ts, schemaVersion }) => {
      const parsed = eventSchema.safeParse(event);
      if (!parsed.success) return [];
      return [
        { ...parsed.data, ...(schemaVersion > 0 ? { timestamp: Date.parse(ts) } : {}) } as Event,
      ];
    });
  }
  list(options: SessionListOptions = {}) {
    return this.#call({ operation: "list", options }, z.array(summarySchema));
  }
  rename(sessionId: string, title: string) {
    return this.#call(
      { operation: "rename", sessionId, title: redactSecrets(title, this.secrets()) },
      summarySchema,
    );
  }
  delete(sessionId: string) {
    return this.#call(
      { operation: "delete", sessionId },
      z.object({ id: z.string(), trash: z.string() }),
    );
  }
  fork(sessionId: string, options: ForkSessionOptions = {}) {
    return this.#call({ operation: "fork", sessionId, options }, summarySchema);
  }
  close(sessionId: string) {
    return this.logs.close(sessionId);
  }
  closeAll() {
    return this.logs.closeAll();
  }
}
