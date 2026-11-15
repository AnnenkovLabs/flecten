import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default ({ server, z, workspace }) => {
  const directory = join(workspace, ".liquid", "studio-harness");
  const path = join(directory, "brief.txt");
  server.registerTool("brief", {
    description: "Read or save the user's project brief in this workspace",
    inputSchema: z.object({ text: z.string().max(32000).optional() }),
  }, async ({ text }) => {
    if (text !== undefined) {
      await mkdir(directory, { recursive: true });
      await writeFile(path, text, "utf8");
    }
    let saved = "";
    try { saved = await readFile(path, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return { content: [{ type: "text", text: saved }] };
  });
};
