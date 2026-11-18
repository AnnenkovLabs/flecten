import { expect, test } from "@playwright/test";
import { launchApp } from "./fixtures";

test("even one standalone chat gets a rescue by the eighth opening", async () => {
  const h = await launchApp({ locale: "en", projectless: true, appProfile: true, reply: "Ready." });
  try {
    const { page } = h;
    await page.locator("#prompt").fill("The only chat");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".thread")).toContainText("Ready.");
    const toggle = page.getByRole("button", { name: "Separate chats", exact: true });
    const drawer = page.locator(".standalone-section .chat-drawer");
    const stage = drawer.locator("canvas");
    await page.evaluate(() => {
      Math.random = () => 0.99;
    });
    for (let opening = 1; opening <= 8; opening++) {
      await toggle.click();
      await expect(drawer).toHaveCount(0);
      await toggle.press("Enter");
      if (opening < 8) {
        await expect(drawer).toHaveAttribute("data-chat-reveal", "slide");
      } else {
        await expect(stage).toBeVisible();
      }
    }
    await toggle.click();
    await expect(drawer).toHaveCount(0);
    await page.evaluate(() => {
      Math.random = () => 0.149;
    });
    await toggle.click();
    await expect(stage).toBeVisible();
  } finally {
    await h.close();
  }
});
