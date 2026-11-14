import { expect, test } from "bun:test";
import { parseProcessScopes } from "../../src/terminal/process-scope";

test("macOS scope membership uses the inherited nonce after a parent exits", () => {
  const identity = "FLECTEN_PROCESS_SCOPE=fixture-nonce";
  expect(
    parseProcessScopes(
      `  23 /path/to/bun worker PATH=/bin ${identity}\n24 other ${identity}-suffix\n25 other PREFIX_${identity}\ninvalid ${identity}`,
      identity,
    ),
  ).toEqual([23]);
});
