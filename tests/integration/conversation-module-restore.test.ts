import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleFixture } from "../helpers/modules";

for (const parentState of ["missing", "empty", "existing"] as const) {
  test(`conversation restores legacy Worker-only activation when parent state is ${parentState}`, async () => {
    const f = await moduleFixture({ conversation: true });
    const sessionId = `restore-${parentState}`;
    const parent = join(f.cwd, ".liquid/sessions", sessionId, "modules.json");
    const child = join(f.cwd, ".liquid/sessions", `${sessionId}_worker`, "modules.json");
    const legacy = JSON.stringify({ schemaVersion: 1, requested: ["studio"] });
    try {
      await f.app.acceptTrust();
      await Bun.write(child, legacy);
      if (parentState !== "missing")
        await Bun.write(
          parent,
          JSON.stringify({
            schemaVersion: 1,
            requested: parentState === "empty" ? [] : ["studio"],
          }),
        );
      const before = parentState === "missing" ? undefined : await Bun.file(parent).text();
      f.script(() => "Restored the conversation.");
      await f.app.session.send({ type: "run", sessionId, prompt: "Continue the previous task." });
      expect((await f.app.modules.state(sessionId)).active.map((module) => module.name)).toEqual(
        parentState === "empty" ? [] : ["studio"],
      );
      expect((await f.app.modules.state(`${sessionId}_worker`)).active).toEqual(
        (await f.app.modules.state(sessionId)).active,
      );
      expect(await Bun.file(child).text()).toBe(legacy);
      expect(await Bun.file(parent).text()).toBe(before ?? legacy);
      expect(f.requests).toHaveLength(1);
    } finally {
      await f.close();
      await rm(f.cwd, { recursive: true, force: true });
    }
  });
}

test("legacy Worker activation never grants trust to a changed package", async () => {
  const f = await moduleFixture({ conversation: true });
  try {
    await f.app.acceptTrust();
    await Bun.write(
      join(f.cwd, ".liquid/sessions/untrusted_worker/modules.json"),
      JSON.stringify({ schemaVersion: 1, requested: ["studio"] }),
    );
    await Bun.write(join(f.root, "instructions.md"), "MODIFIED_UNTRUSTED_INSTRUCTIONS");
    f.script(() => "Restored.");
    await f.app.session.send({ type: "run", sessionId: "untrusted", prompt: "Continue." });
    expect((await f.app.modules.state("untrusted")).active).toEqual([]);
    expect(JSON.stringify(f.requests)).not.toContain("MODIFIED_UNTRUSTED_INSTRUCTIONS");
  } finally {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
});
