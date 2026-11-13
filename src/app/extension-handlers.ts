import { z } from "zod";
import { McpElicitationResponseSchema } from "../mcp/elicitation";
import type { Handler } from "./server-session-handlers";
import type { AppService } from "./service-types";

export const EXTENSION_COMMANDS = [
  "mcp.status",
  "mcp.reconnect",
  "mcp.oauth.start",
  "mcp.oauth.cancel",
  "mcp.elicitation.respond",
  "mcp.resource",
  "mcp.prompt",
  "skills.list",
  "skills.resource",
  "skills.reload",
] as const;
export type ExtensionCommandType = (typeof EXTENSION_COMMANDS)[number];

const Id = z.string().min(1).max(256);
const Args = z.record(z.string().min(1).max(128), z.string().max(8192));

export function extensionHandlers(app: AppService): Record<ExtensionCommandType, Handler> {
  return {
    "mcp.status": () => ({ mcp: app.extensions.status() }),
    "mcp.reconnect": async (command) => ({
      mcp: await app.extensions.reconnect(Id.optional().parse(command.id)),
    }),
    "mcp.oauth.start": async (command) => ({
      authorization: await app.extensions.authorize(Id.parse(command.id)),
    }),
    "mcp.oauth.cancel": (command) => {
      app.extensions.cancelAuthorization(Id.parse(command.id));
      return {};
    },
    "mcp.elicitation.respond": (command) => ({
      answered: app.extensions.answer(
        Id.parse(command.id),
        McpElicitationResponseSchema.parse(command.response),
      ),
    }),
    "mcp.resource": async (command) => ({
      attachedContext: await app.extensions.resource(
        Id.parse(command.server),
        z.string().min(1).max(4096).parse(command.uri),
      ),
    }),
    "mcp.prompt": async (command) => ({
      attachedContext: await app.extensions.prompt(
        Id.parse(command.server),
        Id.parse(command.name),
        Args.optional().parse(command.args),
      ),
    }),
    "skills.resource": async (command) => ({
      resource: await app.extensions.skillResource(
        Id.parse(command.name),
        z.string().min(1).max(4096).parse(command.path),
      ),
    }),
    "skills.list": async () => ({ skills: await app.extensions.skills() }),
    "skills.reload": async () => ({ skills: await app.reloadSkills() }),
  };
}
