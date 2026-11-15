/** Schemas are supplied by the installed module host, never a second Zod dependency. */
export function computerSchemas(z) {
  const coordinate = z.number().int().min(0).max(1919);
  const point = { x: coordinate, y: coordinate };
  const action = z.discriminatedUnion('type', [
    z.object({ type: z.literal('click'), ...point, button: z.enum(['left', 'middle', 'right']).default('left'), clickCount: z.number().int().min(1).max(2).default(1) }).strict(),
    z.object({ type: z.literal('move'), ...point }).strict(),
    z.object({ type: z.literal('drag'), fromX: coordinate, fromY: coordinate, toX: coordinate, toY: coordinate }).strict(),
    z.object({ type: z.literal('scroll'), ...point, direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(20).default(3) }).strict(),
    z.object({ type: z.literal('type'), text: z.string().min(1).max(8000) }).strict(),
    z.object({ type: z.literal('key'), keys: z.array(z.enum(['Ctrl','Alt','Shift','Super','Return','Tab','Escape','BackSpace','Delete','Home','End','Page_Up','Page_Down','Up','Down','Left','Right','space', ...'abcdefghijklmnopqrstuvwxyz0123456789'])).min(1).max(5) }).strict(),
    z.object({ type: z.literal('wait'), durationMs: z.number().int().min(0).max(2000).default(500) }).strict(),
  ]);
  const observationId = z.string().uuid();
  const reason = z.string().min(1).max(300);
  const url = z.string().url().max(4096).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS URL');
  return {
    status: z.object({}).strict(),
    preview: z.object({}).strict(),
    start: z.object({ width: z.number().int().min(800).max(1920).default(1280), height: z.number().int().min(600).max(1200).default(800) }).strict(),
    observe: z.object({ refresh: z.boolean().default(true) }).strict(),
    act: z.object({ observationId, action, reason }).strict(),
    interact: z.object({ observationId, action, reason }).strict(),
    navigate: z.object({ observationId, url, reason }).strict(),
    control: z.object({ operation: z.enum(['take_over', 'resume', 'stop']) }).strict(),
  };
}
