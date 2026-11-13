import type { z } from "zod";
import type { MarketplaceAction, MarketplaceState } from "../../../../shared/module-marketplace";
import type {
  ModuleChange,
  ModuleFrameRequestSchema,
  ModuleState,
} from "../../../../shared/modules";

export type ModuleCommand =
  | ({ type: "modules.marketplace"; requestId: string } & MarketplaceAction)
  | { type: "modules.list"; requestId: string; sessionId?: string }
  | ({ type: "modules.change"; requestId: string } & ModuleChange)
  | {
      type: "modules.surface";
      requestId: string;
      sessionId?: string;
      name: string;
      surface: string;
      revision: string;
    }
  | {
      type: "modules.invoke";
      requestId: string;
      sessionId: string;
      name: string;
      surface: string;
      revision: string;
      request: z.infer<typeof ModuleFrameRequestSchema>;
    }
  | { type: "modules.styles"; requestId: string; name: string; revision: string }
  | {
      type: "modules.authorize";
      requestId: string;
      sessionId?: string;
      name: string;
      surface: string;
      revision: string;
      request: z.infer<typeof ModuleFrameRequestSchema>;
    };
export interface ModuleResponse {
  moduleMarketplace?: MarketplaceState;
  moduleState?: ModuleState;
  moduleHtml?: string;
  moduleResult?: unknown;
  moduleStyles?: string[];
  moduleAuthorized?: boolean;
}
