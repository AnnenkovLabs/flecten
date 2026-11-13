import { type TwinActivity, TwinActivitySchema } from "../../../../shared/twin-activity";

/** A task's durable representative dialogue, rebuilt by the same live/replay path. */
export class TwinView {
  items = $state<TwinActivity[]>([]);
  get latest(): TwinActivity | undefined {
    return this.items.at(-1);
  }
  get busy(): boolean {
    return this.latest?.state === "running";
  }
  reset(): void {
    this.items = [];
  }
  apply(activity: TwinActivity): void {
    const parsed = TwinActivitySchema.parse(activity);
    if (parsed.state === "disabled") {
      this.reset();
      return;
    }
    const history =
      this.latest?.state === "running" && this.latest.phase === activity.phase
        ? this.items.slice(0, -1)
        : this.items;
    this.items = [...history.slice(-39), parsed];
  }
  disconnected(): void {
    if (this.busy && this.latest) this.apply({ ...this.latest, state: "cancelled" });
  }
}
