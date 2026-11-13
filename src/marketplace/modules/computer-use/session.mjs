import { randomUUID } from 'node:crypto';

/** The runtime owns control and observation identity; the backend only operates the private display. */
export class ComputerSession {
  instanceId = randomUUID();
  state = 'idle';
  control = 'agent';
  observation = null;
  previewObservation = null;
  browserNavigation = 'not-requested';
  history = [];
  error = null;
  #queue = Promise.resolve();
  #active = null;
  #epoch = 0;
  #previewing = null;
  constructor(backend) { this.backend = backend; }

  snapshot() {
    const capabilities = this.backend.status();
    if (['ready', 'human'].includes(this.state) && capabilities.ready === false) {
      this.state = 'error'; this.observation = null; this.previewObservation = null;
      this.error = 'The private desktop stopped unexpectedly. Start the desktop again.';
    }
    return { version: 1, instanceId: this.instanceId, state: this.state, control: this.control, observation: this.observation ? this.#metadata(this.observation) : null,
      preview: this.previewObservation ? this.#metadata(this.previewObservation) : null, browserNavigation: this.browserNavigation,
      history: this.history.slice(-50), capabilities, error: this.error };
  }

  #metadata(observation) {
    const { image, ...metadata } = observation;
    return metadata;
  }

  #record(actor, action, status, reason, error) {
    this.history.push({ id: randomUUID(), at: new Date().toISOString(), actor, action, status, ...(reason ? { reason } : {}), ...(error ? { error } : {}) });
    if (this.history.length > 100) this.history.shift();
  }

  #serialize(signal, task) {
    const epoch = this.#epoch;
    const run = async () => {
      signal.throwIfAborted();
      if (epoch !== this.#epoch) throw new Error('Control changed. Observe the desktop before another action.');
      const controller = new AbortController();
      this.#active = controller;
      const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(30000)]);
      try { return await task(combined); }
      finally { if (this.#active === controller) this.#active = null; }
    };
    const result = this.#queue.then(run);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #capture(signal) {
    const image = await this.backend.observe(signal);
    signal.throwIfAborted();
    this.observation = { ...image, id: randomUUID(), capturedAt: image.capturedAt ?? new Date().toISOString() };
    this.previewObservation = null;
    this.error = null;
    return this.snapshot();
  }

  #ready() {
    if (!['ready', 'human'].includes(this.state)) throw new Error('Start the desktop before observing or acting.');
  }

  #guard(id, actor) {
    this.#ready();
    if (this.control !== actor) throw new Error(this.control === 'human' ? 'The human has control. Wait for Resume agent.' : 'Take over before sending manual input.');
    const observation = actor === 'human' && this.previewObservation?.id === id ? this.previewObservation : this.observation;
    if (!observation || observation.id !== id) throw new Error('The observation is stale. Observe the desktop and use its current observationId.');
  }

  start(options, signal) {
    return this.#serialize(signal, async active => {
      if (['ready', 'human'].includes(this.state)) return this.snapshot();
      if (this.state === 'error') await this.backend.stop();
      this.state = 'starting'; this.error = null; this.browserNavigation = 'not-requested';
      try {
        await this.backend.start(options, active);
        this.state = 'ready'; this.control = 'agent';
        await this.#capture(active);
        this.#record('agent', 'start', 'completed');
        return this.snapshot();
      } catch (error) {
        await this.backend.stop();
        this.state = 'error'; this.error = String(error.message ?? error); throw error;
      }
    });
  }

  observe({ refresh = true } = {}, signal) {
    if (!refresh) return Promise.resolve(this.snapshot());
    return this.#serialize(signal, async active => { this.#ready(); return this.#capture(active); });
  }

  preview(signal) {
    this.#previewing ??= this.#serialize(signal, async active => {
      if (!['ready', 'human'].includes(this.state)) return this.snapshot();
      const image = await this.backend.observe(active);
      active.throwIfAborted();
      this.previewObservation = { ...image, id: randomUUID(), capturedAt: image.capturedAt ?? new Date().toISOString() };
      return { ...this.snapshot(), previewImage: image.image };
    }).finally(() => { this.#previewing = null; });
    return this.#previewing;
  }

  act({ observationId, action, reason }, signal, actor = 'agent') {
    return this.#serialize(signal, async active => {
      this.#guard(observationId, actor);
      this.observation = null; this.previewObservation = null;
      try {
        await this.backend.act(action, active);
        this.#record(actor, action.type, 'completed', reason);
      } catch (error) {
        const rejected = error.delivery === 'not-delivered';
        this.#record(actor, action.type, rejected ? 'rejected' : 'uncertain', reason, String(error.message ?? error));
        if (rejected) throw new Error(`Input was rejected before delivery: ${error.message}`, { cause: error });
        throw new Error('Input may have been delivered. Observe before deciding whether to retry.', { cause: error });
      }
      try { await this.#capture(active); }
      catch (error) { this.error = 'Action delivered; screenshot failed. Observe before continuing.'; throw new Error(this.error, { cause: error }); }
      return this.snapshot();
    });
  }

  navigate({ observationId, url, reason }, signal, actor = 'agent') {
    return this.#serialize(signal, async active => {
      this.#guard(observationId, actor);
      this.observation = null; this.previewObservation = null;
      try {
        await this.backend.launch({ url }, active);
        this.browserNavigation = 'dispatched';
        this.#record(actor, 'navigate', 'completed', reason);
      } catch (error) {
        const rejected = error.delivery === 'not-delivered';
        this.#record(actor, 'navigate', rejected ? 'rejected' : 'uncertain', reason);
        if (rejected) throw new Error(`Navigation was rejected before delivery: ${error.message}`, { cause: error });
        throw new Error('Navigation may have been delivered. Observe before retrying.', { cause: error });
      }
      return this.#capture(active);
    });
  }

  async changeControl(operation, signal) {
    if (operation !== 'stop') this.#ready();
    // Revoke ownership before waiting for in-flight input; a queued agent action cannot cross handoff.
    this.#epoch++; this.#active?.abort();
    this.observation = null; this.previewObservation = null;
    if (operation === 'stop') {
      this.state = 'stopped'; this.control = 'human'; this.browserNavigation = 'not-requested';
      // Accepted stop is cleanup, not cancellable input. It must outlive its caller and later handoffs.
      const cleanup = this.#queue.then(async () => {
        await this.backend.stop(); this.state = 'stopped'; this.control = 'human';
        this.#record('human', operation, 'completed');
        return this.snapshot();
      });
      this.#queue = cleanup.catch(() => {});
      return cleanup;
    }
    if (operation === 'take_over') { this.state = 'human'; this.control = 'human'; }
    else { this.state = 'ready'; this.control = 'agent'; }
    return this.#serialize(signal, async active => {
      await this.#capture(active);
      this.#record('human', operation, 'completed');
      return this.snapshot();
    });
  }
}
