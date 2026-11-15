import { z } from "zod";

const Name = z.string().trim().min(1).max(80);
const KEY = "flecten.userName";

function savedName(): string | undefined {
  try {
    const parsed = Name.safeParse(globalThis.localStorage?.getItem(KEY));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export class UserProfile {
  name = $state(savedName());

  rename(value: string): void {
    const name = Name.parse(value);
    localStorage.setItem(KEY, name);
    this.name = name;
  }
}
