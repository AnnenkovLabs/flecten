import type { Page } from "@playwright/test";

/** Ordinary tests acknowledge the real upgrade flow; migration tests exercise it manually. */
export async function acceptStorageUpgrade(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const agent = window.desktop?.agent;
        if (!agent) {
          reject(new Error("Desktop bridge unavailable"));
          return;
        }
        let started = false;
        let accepted = false;
        const timer = setTimeout(
          () => finish(new Error("Storage upgrade did not complete")),
          30000,
        );
        const unsubscribe = agent.onEvent((event) => {
          if (
            event.type === "status" ||
            (event.type === "response" &&
              event.requestId === "fixture-storage" &&
              event.migration === null)
          )
            finish();
          if (event.type !== "storage.migration") return;
          if (event.migration.phase === "failed") finish(new Error(event.migration.error));
          else if (event.migration.phase === "required" && !started) {
            started = true;
            agent.send({ type: "storage.migrate", requestId: "fixture-migrate" });
          } else if (event.migration.phase === "complete" && !accepted) {
            accepted = true;
            agent.send({ type: "storage.accept", requestId: "fixture-accept" });
          }
        });
        function finish(error?: Error) {
          clearTimeout(timer);
          unsubscribe();
          if (error) reject(error);
          else resolve();
        }
        agent.send({ type: "storage.status", requestId: "fixture-storage" });
      }),
  );
}
