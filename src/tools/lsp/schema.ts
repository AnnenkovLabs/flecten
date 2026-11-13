import { z } from "zod";

export const lspOperations = [
  "diagnostics",
  "definition",
  "references",
  "symbols",
  "rename",
  "format",
] as const;

export type LspOperation = (typeof lspOperations)[number];

export const lspSpec = {
  name: "lsp",
  description:
    "Query a language server for a file: diagnostics, definition, references, document symbols, rename preview or formatter diff. line and character are 1-based. Servers and formatters come from the lsp config in the tool context; command and args override the resolved server.",
  schema: z
    .object({
      operation: z.enum(lspOperations).describe("Language server or formatter operation"),
      path: z.string().min(1).describe("File path, relative to the project or absolute"),
      line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based line for definition, references and rename"),
      character: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based character for definition, references and rename"),
      newName: z.string().min(1).optional().describe("New name for rename"),
      command: z.string().min(1).optional().describe("Language server executable"),
      args: z
        .array(z.string())
        .optional()
        .describe("Language server arguments, for example --stdio"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(60_000)
        .optional()
        .describe("Request or diagnostics wait timeout in milliseconds"),
    })
    .strict(),
};

export type LspArgs = z.infer<typeof lspSpec.schema>;
