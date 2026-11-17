/** Read a renamed preference without discarding the value from an existing profile. */
export function readPreference(key: string, legacyKey: string): string | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const current = storage.getItem(key);
    if (current !== null) return current;
    const legacy = storage.getItem(legacyKey);
    if (legacy !== null) {
      try {
        storage.setItem(key, legacy);
        storage.removeItem(legacyKey);
      } catch {
        // A read-only profile can still use the saved preference.
      }
    }
    return legacy;
  } catch {
    return null;
  }
}
