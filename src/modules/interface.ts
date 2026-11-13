import { MODULE_SURFACE_BYTES } from "../../shared/module-interface";
import { ModuleFrameRequestSchema } from "../../shared/modules";
import type { ModuleCatalog } from "./catalog";
import type { ModuleGeneration } from "./generation";
import { moduleText } from "./package";

/** Interface assets are available before a chat exists, without starting a model or runtime. */
export class ModuleInterfaces {
  constructor(
    readonly catalog: ModuleCatalog,
    readonly trusted: () => boolean,
    readonly generation: (session: string, name: string) => ModuleGeneration | undefined,
  ) {}

  selected() {
    return [...this.catalog.modules.values()].filter(
      (m) => m.view.enabled && m.view.interfaceEnabled,
    );
  }
  async source(session: string, name: string, revision: string) {
    await this.catalog.refresh();
    const current = this.catalog.modules.get(name);
    if (!this.trusted() || !current?.view.enabled)
      throw new Error("Module is not trusted or enabled");
    const active = this.generation(session, name)?.module;
    const source =
      active?.revision === revision ? active : current.view.interfaceEnabled ? current : undefined;
    if (!source || source.revision !== revision)
      throw new Error("Module surface changed. Reopen it.");
    return source;
  }
  async surface(session: string, name: string, id: string, revision: string) {
    const source = await this.source(session, name, revision);
    const surface = source.manifest.surfaces.find((s) => s.id === id);
    if (!surface) throw new Error("Unknown module surface");
    return { source, surface };
  }
  async html(session: string, name: string, id: string, revision: string) {
    const { source, surface } = await this.surface(session, name, id, revision);
    return moduleText(source, surface.entry, MODULE_SURFACE_BYTES);
  }
  async styles(name: string, revision: string) {
    const source = await this.source("", name, revision);
    return source.manifest.styles.map((path) => moduleText(source, path, 256_000));
  }
  async authorize(session: string, name: string, id: string, revision: string, raw: unknown) {
    const request = ModuleFrameRequestSchema.parse(raw);
    const { surface } = await this.surface(session, name, id, revision);
    if (
      request.command?.type === "interface.styles" &&
      !this.catalog.modules.get(name)?.view.interfaceEnabled
    )
      throw new Error("Select this module interface before changing the application styles");
    const allowed =
      request.method === "snapshot"
        ? surface.harness.state
        : request.method === "subscribe"
          ? surface.harness.events
          : request.method === "request" && request.command
            ? surface.harness.commands.includes(request.command.type)
            : false;
    if (!allowed) throw new Error("Harness access is not granted to this surface");
    return true;
  }
}
