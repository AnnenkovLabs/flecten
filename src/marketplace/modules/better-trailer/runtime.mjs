export default ({ server, z }) => {
  server.registerTool("timeline", {
    description: "Calculate a frame-accurate trailer timeline from named shots.",
    inputSchema: z.object({
      framesPerSecond: z.number().int().min(1).max(240),
      shots: z.array(z.object({ title: z.string().min(1).max(200), seconds: z.number().positive().max(3600) })).min(1).max(200),
    }),
  }, async ({ framesPerSecond, shots }) => {
    let cursor = 0;
    const timeline = shots.map((shot) => {
      const frames = Math.max(1, Math.round(shot.seconds * framesPerSecond));
      const item = { title: shot.title, startFrame: cursor, frames };
      cursor += frames;
      return item;
    });
    return { content: [{ type: "text", text: JSON.stringify({ framesPerSecond, totalFrames: cursor, seconds: cursor / framesPerSecond, timeline }) }] };
  });
};
