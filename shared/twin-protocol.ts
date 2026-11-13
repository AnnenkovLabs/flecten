import type { z } from "zod";
import type {
  TwinConfigureSchema,
  TwinConsultSchema,
  TwinForgetSchema,
  TwinReviewSchema,
  TwinTeachSchema,
  TwinTrainSchema,
  TwinUpdateSchema,
} from "./twin";

export type TwinCommand = { requestId: string } & (
  | { type: "twin.get" | "twin.scan" | "twin.cancel" }
  | ({ type: "twin.train" } & z.input<typeof TwinTrainSchema>)
  | ({ type: "twin.configure" } & z.input<typeof TwinConfigureSchema>)
  | ({ type: "twin.review" } & z.input<typeof TwinReviewSchema>)
  | ({ type: "twin.forget" } & z.input<typeof TwinForgetSchema>)
  | ({ type: "twin.teach" } & z.input<typeof TwinTeachSchema>)
  | ({ type: "twin.consult" } & z.input<typeof TwinConsultSchema>)
  | ({ type: "twin.update" } & z.input<typeof TwinUpdateSchema>)
);
