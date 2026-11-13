import {
  checkUpdate,
  downloadUpdate,
  getUpdaterState,
  installUpdate,
  onUpdaterStatus,
  type UpdaterStatus,
} from "./desktop";

/** One live update state for the titlebar chip and the About settings card. */
class UpdaterStore {
  status = $state<UpdaterStatus | null>(null);
  #started = false;

  start(): void {
    if (this.#started) return;
    this.#started = true;
    onUpdaterStatus((status) => {
      this.status = status;
    });
    void getUpdaterState()
      .then((status) => {
        if (status && this.status === null) this.status = status;
      })
      .catch(() => undefined);
  }

  async check(): Promise<void> {
    this.status = (await checkUpdate()) ?? this.status;
  }

  async download(): Promise<void> {
    this.status = (await downloadUpdate()) ?? this.status;
  }

  async install(): Promise<void> {
    this.status = (await installUpdate()) ?? this.status;
  }
}

export const updater = new UpdaterStore();
