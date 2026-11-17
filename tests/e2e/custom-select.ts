import { expect, type Locator } from "@playwright/test";

export async function selectOptions(control: Locator): Promise<Locator> {
  control = control.and(control.page().getByRole("combobox"));
  await control.click();
  const id = await control.getAttribute("aria-controls");
  if (!id) throw new Error("The select does not identify its listbox");
  const listbox = control.page().locator(`[id=${JSON.stringify(id)}]`);
  await expect(listbox).toBeVisible();
  return listbox.getByRole("option");
}

export async function chooseSelect(control: Locator, value: string): Promise<void> {
  const options = await selectOptions(control);
  await options.and(control.page().locator(`[data-value=${JSON.stringify(value)}]`)).click();
}
