import { productEnv } from "../shared/environment.cjs";
// `bun run app:shot`: drives the window through the FLECTEN_SHOT_* steps and saves screenshots.
import { writeFileSync } from "node:fs";

/** After the first load: optional prompt, expand and settings steps, then the screenshots and quit. */
export function captureWhenLoaded(win, path, quit) {
  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      if (productEnv("SHOT_PROMPT")) {
        const prompt = JSON.stringify(productEnv("SHOT_PROMPT"));
        await win.webContents.executeJavaScript(`(async () => {
          const editor = document.querySelector("#prompt");
          if (!editor) return false;
          editor.focus();
          document.execCommand("selectAll");
          document.execCommand("insertText", false, ${prompt});
          await new Promise((resolve) => setTimeout(resolve, 200));
          document.querySelector(".send")?.click();
          return true;
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 9000));
      }
      if (productEnv("SHOT_EXPAND") === "1") {
        await win.webContents.executeJavaScript(
          'document.querySelector(".run-summary")?.click(); true',
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (productEnv("SHOT_TOOL") === "1") {
        await win.webContents.executeJavaScript(
          'document.querySelector(".action")?.click(); true',
        );
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (productEnv("SHOT_SETTINGS") === "1") {
        await win.webContents.executeJavaScript(
          'document.querySelector(".tb-btn[aria-label=\'Настройки\']")?.click()',
        );
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      try {
        const image = await win.webContents.capturePage();
        writeFileSync(path, image.toPNG());
        const hasThread = await win.webContents.executeJavaScript(
          'Boolean(document.querySelector(".thread"))',
        );
        if (hasThread) {
          await win.webContents.executeJavaScript(
            'document.querySelector(".thread").scrollTop = 99999',
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
          const bottom = await win.webContents.capturePage();
          writeFileSync(path.replace(".png", "-bottom.png"), bottom.toPNG());
        }
      } finally {
        app.quit();
      }
    }, 1200);
  });
}
