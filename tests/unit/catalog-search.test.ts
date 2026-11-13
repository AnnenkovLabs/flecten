import { expect, test } from "bun:test";
import { filterCatalog } from "../../ui/src/lib/settings-utils";

test("finds CommandCode with the spaced query from the provider dialog", () => {
  const catalog = [
    {
      id: "commandcode",
      name: "CommandCode",
      protocol: "openai-chat" as const,
      baseUrl: "https://api.commandcode.ai/provider/v1",
      modelCount: 72,
    },
  ];
  expect(filterCatalog(catalog, "command code")).toEqual(catalog);
  expect(filterCatalog(catalog, " COMMANDCODE ")).toEqual(catalog);
  expect(filterCatalog(catalog, "api.commandcode.ai")).toEqual(catalog);
  expect(filterCatalog(catalog, "")).toEqual(catalog);
  expect(filterCatalog(catalog, "missing")).toEqual([]);
});
