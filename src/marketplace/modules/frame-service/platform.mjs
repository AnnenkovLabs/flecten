export default ({ services, defineService, z }) => {
  const frames = defineService("trailer.frames@1", z.object({ seconds: z.number().positive(), fps: z.number().int().positive() }), z.object({ frames: z.number().int().nonnegative() }));
  services.provide(frames, async ({ seconds, fps }, signal) => {
    signal.throwIfAborted();
    return { frames: Math.round(seconds * fps) };
  });
};
