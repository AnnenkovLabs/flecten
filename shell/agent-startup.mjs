/** A project lock is terminal until the person retries or chooses another project. */
export class AgentStartup {
  #locked = null;

  note(message) {
    if (message.type === "error" && message.code === "project_locked") this.#locked = message;
    else if (message.type === "status") this.reset();
  }

  reset() { this.#locked = null; }

  route(command) {
    if (!this.#locked) return { action: "send" };
    if (command.type === "hello" || command.type === "run") {
      this.reset();
      return { action: "restart" };
    }
    return {
      action: "blocked",
      ...(command.requestId ? { response: {
        type: "response", requestId: command.requestId, ok: false, error: this.#locked.message,
      } } : {}),
    };
  }
}
