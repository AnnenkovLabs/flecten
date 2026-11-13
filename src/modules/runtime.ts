import description from "../../prompts/tool-description-module.md" with { type: "text" };
import { ModuleFrameRequestSchema, type ModuleState } from "../../shared/modules";
import type { ModuleSessionPort, ModuleSurfaceInput } from "../core/modules/types";
import { harnessServices } from "../core/services/contracts";
import { Services } from "../core/services/registry";
import type { Message, ToolResult } from "../core/types";
import { defineTool, type ToolContext } from "../tools/types";
import { markdownData } from "../util/markdown";
import { type ModuleAction, ModuleActionSchema } from "./actions";
import type { ModuleCatalog } from "./catalog";
import type { ModuleRuntimeOptions } from "./generation";
import { ModuleInterfaces } from "./interface";
import { ProjectPlatforms } from "./project-platforms";
import { ModuleScope } from "./scope";
import { inheritModuleState } from "./session-state";

const PAGE_SIZE = 12;
function page<T>(items: readonly T[], offset = 0) {
  return {
    items: items.slice(offset, offset + PAGE_SIZE),
    ...(offset + PAGE_SIZE < items.length ? { nextOffset: offset + PAGE_SIZE } : {}),
  };
}
function result(value: unknown): ToolResult {
  return {
    ok: true,
    output: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
    provenance: { source: "mcp", ref: "module catalog" },
  };
}

export class ModuleRuntime implements ModuleSessionPort {
  readonly #scopes = new Map<string, ModuleScope>();
  readonly #sessionOwners = new Map<string, string>();
  readonly #participants = new Map<string, Set<string>>();
  readonly interfaces: ModuleInterfaces;
  readonly #platformErrors = new Map<string, string>();
  readonly project: ProjectPlatforms;
  readonly tool = defineTool({
    name: "module",
    source: "module",
    mutating: true,
    description: description.trim(),
    schema: ModuleActionSchema,
    timeoutMs: () => 300_000,
    execute: (action, context) => this.execute(action, context),
  });

  constructor(
    readonly catalog: ModuleCatalog,
    readonly trusted: () => boolean,
    readonly options: ModuleRuntimeOptions = {},
  ) {
    options.reportPlatformError = (owner, error) =>
      this.#platformErrors.set(
        owner,
        (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      );
    this.project = new ProjectPlatforms(catalog, trusted, options.reportPlatformError, (layers) => {
      for (const scope of this.#scopes.values())
        new Services(() => [
          ...layers,
          ...scope.generations
            .filter((g) => catalog.modules.get(g.module.manifest.name)?.view.enabled)
            .flatMap((g) => (g.platform ? [g.platform.layer] : [])),
        ]).validate(Object.values(harnessServices));
    });
    options.services = (sessionId) => this.services(sessionId);
    this.interfaces = new ModuleInterfaces(catalog, trusted, (session, name) =>
      this.#scopes
        .get(this.#scopeId(session))
        ?.generations.find((g) => g.module.manifest.name === name),
    );
  }

  async shareSession(ownerId: string, participantId: string): Promise<void> {
    if (ownerId === participantId) return;
    const previous = this.#sessionOwners.get(participantId);
    if (this.#sessionOwners.has(ownerId) || (previous && previous !== ownerId))
      throw new Error("A module session already belongs to another conversation");
    if (this.#scopes.has(participantId))
      throw new Error("Share module sessions before activating their runtimes");
    await inheritModuleState(this.catalog.cwd, ownerId, participantId);
    this.#sessionOwners.set(participantId, ownerId);
    let members = this.#participants.get(ownerId);
    if (!members) {
      members = new Set([ownerId]);
      this.#participants.set(ownerId, members);
    }
    members.add(participantId);
  }

  #scopeId(sessionId: string): string {
    return this.#sessionOwners.get(sessionId) ?? sessionId;
  }

  services(sessionId?: string): Services {
    return new Services(
      () => [
        ...this.project.services.layers(),
        ...(this.trusted() && sessionId
          ? (this.#scopes
              .get(this.#scopeId(sessionId))
              ?.generations.filter(
                (g) => this.catalog.modules.get(g.module.manifest.name)?.view.enabled,
              )
              .flatMap((g) => (g.platform ? [g.platform.layer] : [])) ?? [])
          : []),
      ],
      this.project.services.context,
      sessionId,
    );
  }

  #scope(sessionId: string): ModuleScope {
    const ownerId = this.#scopeId(sessionId);
    let scope = this.#scopes.get(ownerId);
    if (!scope) {
      scope = new ModuleScope(this.catalog, ownerId, this.options);
      this.#scopes.set(ownerId, scope);
    }
    return scope;
  }

  async prepare(
    sessionId: string,
    history: readonly Message[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.trusted()) return;
    await this.project.prepare(signal);
    await this.#scope(sessionId).prepare(history, signal);
  }
  async beforeTurn(sessionId: string, history: readonly Message[], signal: AbortSignal) {
    if (!this.trusted()) return undefined;
    await this.project.prepare(signal);
    return this.#scope(sessionId).beforeTurn(history, signal);
  }
  hooks(sessionId: string) {
    return this.trusted() ? (this.#scopes.get(this.#scopeId(sessionId))?.hooks ?? {}) : {};
  }

  async state(sessionId?: string): Promise<ModuleState> {
    await this.catalog.refresh();
    await this.project.prepare(new AbortController().signal);
    const scope = sessionId ? this.#scopes.get(this.#scopeId(sessionId)) : undefined;
    const selected = this.trusted() ? this.interfaces.selected() : [];
    const surfaces = new Map<string, ModuleState["surfaces"][number]>();
    for (const module of [...(scope?.generations ?? []).map((g) => g.module), ...selected]) {
      for (const surface of module.manifest.surfaces) {
        if (surface.placement && !selected.some((m) => m.manifest.name === module.manifest.name))
          continue;
        surfaces.set(`${module.manifest.name}:${surface.id}`, {
          module: module.manifest.name,
          id: surface.id,
          title: surface.title,
          revision: module.revision,
          ...(surface.placement ? { placement: surface.placement } : {}),
          harness: surface.harness,
        });
      }
    }
    return {
      revision: this.catalog.revision,
      modules: [...this.catalog.modules.values()].map((m) => m.view),
      active: scope?.references ?? [],
      services: this.services(sessionId).inspect(),
      errors: [
        ...this.catalog.errors,
        ...[...this.#platformErrors].map(([path, message]) => ({ path, message })),
        ...(this.project.error ? [{ path: "project services", message: this.project.error }] : []),
      ],
      surfaces: [...surfaces.values()],
      interfaces: selected.map((m) => ({
        module: m.manifest.name,
        revision: m.revision,
        styles: m.manifest.styles.length,
        surfaces: m.manifest.surfaces.filter((s) => s.placement).map((s) => s.id),
      })),
    };
  }

  async execute(action: ModuleAction, context: ToolContext): Promise<ToolResult> {
    await this.catalog.refresh();
    if (action.operation === "list") {
      const modules = [...this.catalog.modules.values()].filter(
        (m) => !action.capability || m.manifest.capabilities.includes(action.capability),
      );
      return result({
        ...page(
          modules.map((m) => ({
            name: m.manifest.name,
            description: m.manifest.description,
            capabilities: m.manifest.capabilities,
            enabled: m.view.enabled,
          })),
          action.offset,
        ),
        errors: this.catalog.errors,
      });
    }
    if (!this.trusted() && action.operation === "activate")
      await this.options.requestTrust?.(context);
    if (!this.trusted()) throw new Error("Accept project trust before activating modules");
    const scope = this.#scope(context.sessionId);
    if (action.operation === "status") return result(await this.state(context.sessionId));
    if (action.operation === "activate" || action.operation === "deactivate") {
      const delivery = await scope.change(
        action.name,
        action.operation === "activate",
        context.signal,
      );
      return {
        ok: true,
        output: delivery.text,
        data: { kind: "module", moduleReferences: delivery.references },
      };
    }
    const generation = scope.require(action.name);
    if (!this.catalog.modules.get(action.name)?.view.enabled)
      throw new Error(`Module ${action.name} is no longer trusted or enabled`);
    if (action.operation === "call") return generation.call(action.tool, action.arguments, context);
    if (action.operation === "tools")
      return result(
        page(
          generation.mcp.tools.map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          })),
          action.offset,
        ),
      );
    return this.#read(
      generation.resource(action.resource),
      action.name,
      action.resource,
      action.offset,
    );
  }

  #read(text: string, module: string, resource: string, offset = 0): ToolResult {
    const end = Math.min(text.length, offset + 12_000);
    return {
      ok: true,
      output: markdownData(
        "Module resource",
        [
          ["Module", module],
          ["Resource", resource],
          ["Offset", String(offset)],
          ["Next offset", end < text.length ? String(end) : undefined],
        ],
        text.slice(offset, end),
      ),
      provenance: { source: "file", ref: `module:${module}/${resource}` },
    };
  }

  async surface(sessionId: string, name: string, id: string, revision: string) {
    return this.interfaces.html(sessionId, name, id, revision);
  }
  interfaceStyles(name: string, revision: string) {
    return this.interfaces.styles(name, revision);
  }
  authorizeSurface(
    sessionId: string,
    name: string,
    id: string,
    revision: string,
    request: unknown,
  ) {
    return this.interfaces.authorize(sessionId, name, id, revision, request);
  }

  async invokeSurface(input: ModuleSurfaceInput, context: ToolContext): Promise<ToolResult> {
    if (!this.trusted()) throw new Error("Project trust required");
    const request = ModuleFrameRequestSchema.parse(input.request);
    await this.catalog.refresh();
    if (!this.catalog.modules.get(input.name)?.view.enabled)
      throw new Error("Module is no longer enabled");
    await this.interfaces.surface(context.sessionId, input.name, input.surface, input.revision);
    const scope = this.#scope(context.sessionId);
    await scope.prepare([], context.signal);
    if (!scope.generations.some((g) => g.module.manifest.name === input.name)) {
      if (!this.catalog.modules.get(input.name)?.view.interfaceEnabled)
        throw new Error("Module is not active");
      await scope.change(input.name, true, context.signal);
    }
    const generation = scope.require(input.name);
    if (input.revision !== generation.module.revision)
      throw new Error("Module surface changed. Reopen it.");
    const surface = generation.surface(input.surface);
    if (request.method === "tools")
      return result(
        generation.mcp.tools
          .filter((tool) => surface.tools.includes(tool.name))
          .map(({ name, description, parameters }) => ({ name, description, parameters })),
      );
    if (request.method === "call") {
      if (!request.tool || !surface.tools.includes(request.tool))
        throw new Error("Tool is not granted to this surface");
      return generation.call(request.tool, request.arguments ?? {}, context);
    }
    if (
      request.method !== "read" ||
      !request.resource ||
      !surface.resources.includes(request.resource)
    )
      throw new Error("Resource is not granted to this surface");
    return this.#read(
      generation.resource(request.resource),
      input.name,
      request.resource,
      request.offset,
    );
  }

  async close(sessionId: string): Promise<void> {
    const ownerId = this.#scopeId(sessionId);
    const members = this.#participants.get(ownerId);
    if (members) {
      if (!members.delete(sessionId) || members.size) return;
      this.#participants.delete(ownerId);
      for (const [participant, owner] of this.#sessionOwners)
        if (owner === ownerId) this.#sessionOwners.delete(participant);
    }
    const scope = this.#scopes.get(ownerId);
    this.#scopes.delete(ownerId);
    await scope?.close();
  }
  async dispose(): Promise<void> {
    this.catalog.close();
    const scopes = [...this.#scopes.values()];
    this.#scopes.clear();
    this.#sessionOwners.clear();
    this.#participants.clear();
    await Promise.all(scopes.map((scope) => scope.close()));
    await this.project.close();
  }
}
