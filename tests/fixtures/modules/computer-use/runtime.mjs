import { DesktopBackend } from './backend.mjs';
import { ComputerSession } from './session.mjs';
import { computerSchemas } from './schemas.mjs';

export default ({ server, z }) => {
  const backend = new DesktopBackend();
  const session = new ComputerSession(backend);
  const schemas = computerSchemas(z);
  const output = (result, image = false, human = false) => {
    const { previewImage, ...snapshot } = result;
    const pixels = image === 'preview' ? previewImage : image ? session.observation?.image : null;
    return {
      // The transcript already contains past tool calls. Only the human viewer needs the full timeline.
      structuredContent: human ? snapshot : { ...snapshot, history: snapshot.history.slice(-1) },
      content: [
        { type: 'text', text: [`## Computer`, `Instance ID: ${snapshot.instanceId}`, `State: ${snapshot.state}`, `Control: ${snapshot.control}`, `Browser navigation: ${snapshot.browserNavigation}`, ...(snapshot.observation ? [
          `Observation ID: ${snapshot.observation.id}`, `Captured at: ${snapshot.observation.capturedAt}`,
          `Coordinates: screenshot pixels, ${snapshot.observation.width} x ${snapshot.observation.height}. Origin: top left.`,
        ] : ['No current observation.']), ...(snapshot.error ? [`Error: ${snapshot.error}`] : [])].join('\n') },
        ...(pixels ? [{ type: 'image', mimeType: pixels.mimeType, data: pixels.data }] : []),
      ],
    };
  };
  const register = (name, description, handle, image = false, humanOnly = false) => {
    server.registerTool(name, { description, inputSchema: schemas[name] }, async (args, extra) => {
      const human = extra.mcpReq._meta?.['flecten.dev/invocation-origin'] === 'module-surface';
      try {
        if (humanOnly && !human) throw new Error('This operation is reserved for the human Computer surface.');
        return output(await handle(args, extra.mcpReq.signal, human), image, human);
      }
      catch (error) {
        return { ...output(session.snapshot(), false, human), isError: true, content: [{ type: 'text', text: String(error.message ?? error) }] };
      }
    });
  };
  register('status', 'Inspect desktop lifecycle, current control owner, observation metadata, action history and dependency readiness. Does not capture an image or change observation identity.', async () => session.snapshot());
  register('preview', 'Human viewer only: capture a fresh preview without changing or consuming the agent observation. Preview IDs cannot ground agent input.', (_args, signal) => session.preview(signal), 'preview', true);
  register('start', 'Start an empty private Linux desktop and return its first screenshot. Firefox is not opened until navigate. Does not control the host pointer. Same OS account, files and network; this is display separation, not a security sandbox.', (args, signal) => session.start(args, signal), true);
  register('observe', 'Observe the private desktop and return a bounded screenshot in its exact coordinate space. refresh:false retrieves the cached frame without changing its identity; use this for a viewer. Default refresh:true captures a new observation before deciding an action.', (args, signal) => session.observe(args, signal), true);
  register('act', 'Perform one agent action using the current observationId and a short expected outcome. Actions are serialized. Returns a fresh screenshot. Stale observations and human ownership are rejected before input. If delivery is uncertain, observe before retrying.', (args, signal) => session.act(args, signal), true);
  register('interact', 'Send manual input only after human takeover using the displayed observation or latest preview ID and exact screenshot coordinates. Reserved for the human surface; agents use act.', (args, signal) => session.act(args, signal, 'human'), true, true);
  register('navigate', 'Open an HTTP or HTTPS URL in the private browser from a fresh observation. Returns a post-navigation screenshot. No filesystem URLs or shell commands.', (args, signal, human) => session.navigate(args, signal, human ? 'human' : 'agent'), true);
  register('control', 'Human surface only: take over, resume agent control with a fresh observation, or stop and release the private desktop. Takeover revokes queued agent input immediately.', ({ operation }, signal) => session.changeControl(operation, signal), true, true);
  return async () => { await session.changeControl('stop', new AbortController().signal); };
};
