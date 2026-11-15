import { writeFile } from "node:fs/promises";
import type { AppHarness } from "./fixtures";

export async function hiddenScreenshot(h: AppHarness, path: string): Promise<void> {
  if (process.env.FLECTEN_E2E_PRIVATE_DISPLAY !== "1") {
    await h.page.screenshot({ path });
    return;
  }
  const size = h.page.viewportSize();
  if (!size) throw new Error("The test viewport size is unavailable");
  const image = await h.app.evaluate(async ({ BrowserWindow }, dimensions) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("The test window is unavailable");
    const wasVisible = window.isVisible() && !window.isMinimized();
    const rect = { x: 0, y: 0, ...dimensions };
    // Painting a minimized window requires mapping it only inside the private Xvfb display.
    window.restore();
    window.showInactive();
    window.setMinimumSize(0, 0);
    window.setContentSize(dimensions.width, dimensions.height);
    try {
      await window.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      await window.webContents.capturePage(rect, { stayHidden: true, stayAwake: true });
      const snapshot = await window.webContents.capturePage(rect, {
        stayHidden: true,
        stayAwake: true,
      });
      const actual = snapshot.getSize();
      if (actual.width !== dimensions.width || actual.height !== dimensions.height)
        throw new Error(
          `Screenshot size ${actual.width}x${actual.height} differs from the viewport`,
        );
      return snapshot.toPNG().toString("base64");
    } finally {
      if (!wasVisible) window.hide();
    }
  }, size);
  await writeFile(path, Buffer.from(image, "base64"));
}
