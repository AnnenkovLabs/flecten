import { z } from "zod";
import { ModuleFrameRequestSchema, ModuleIdSchema } from "../../shared/modules";
import { optionalId, required } from "./server-input";
import type { Handler } from "./server-session-handlers";
import type { AppService } from "./service-types";

export const MODULE_COMMANDS = [
  "modules.list",
  "modules.marketplace",
  "modules.change",
  "modules.surface",
  "modules.invoke",
  "modules.styles",
  "modules.authorize",
] as const;
export type ModuleCommandType = (typeof MODULE_COMMANDS)[number];
const SurfaceInput = z.object({
  name: ModuleIdSchema,
  surface: ModuleIdSchema,
  revision: z.string().min(1).max(128),
});
export function moduleHandlers(app: AppService): Record<ModuleCommandType, Handler> {
  return {
    "modules.marketplace": (command) => app.modules.marketplace(command),
    "modules.list": async (command) => ({
      moduleState: await app.modules.state(optionalId(command, "sessionId")),
    }),
    "modules.change": async (command) => ({ moduleState: await app.modules.change(command) }),
    "modules.surface": async (command) => {
      const { name, surface, revision } = SurfaceInput.parse(command);
      return {
        moduleHtml: await app.modules.surface(
          optionalId(command, "sessionId") ?? "",
          name,
          surface,
          revision,
        ),
      };
    },
    "modules.styles": async (command) => ({
      moduleStyles: await app.modules.styles(
        required(command, "name"),
        required(command, "revision"),
      ),
    }),
    "modules.authorize": async (command) => {
      const { name, surface, revision } = SurfaceInput.parse(command);
      return {
        moduleAuthorized: await app.modules.authorize(
          optionalId(command, "sessionId") ?? "",
          name,
          surface,
          revision,
          command.request,
        ),
      };
    },
    "modules.invoke": async (command) => {
      const input = {
        ...SurfaceInput.parse(command),
        request: ModuleFrameRequestSchema.parse(command.request),
      };
      if (JSON.stringify(input).length > 64_000) throw new Error("Module request exceeds 64 KB");
      return {
        moduleResult: await app.session.send({
          type: "modules.invoke",
          sessionId: required(command, "sessionId"),
          input,
        }),
      };
    },
  };
}
