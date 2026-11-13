import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Mutex } from "../../util/mutex";
import { emptyState, type OAuthState, VaultState } from "./state";

export function secret(): string {
  return randomBytes(32).toString("base64url");
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function matches(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)));
}

export class OAuthVault {
  readonly #mutex = new Mutex();
  readonly #path: string;
  readonly #key: Buffer;
  #state: OAuthState;

  private constructor(path: string, key: Buffer, state: OAuthState) {
    this.#path = path;
    this.#key = key;
    this.#state = state;
  }

  static async open(path: string, key: Buffer): Promise<OAuthVault> {
    let state = emptyState();
    try {
      const encrypted = await readFile(path);
      const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
      decipher.setAAD(Buffer.from("x-chatgpt-oauth-v1"));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const plaintext = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]);
      state = VaultState.parse(JSON.parse(plaintext.toString("utf8")));
      await chmod(path, 0o600);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw new Error(
          "Cannot decrypt the X OAuth store. Check its encryption key and file integrity.",
        );
      }
    }
    return new OAuthVault(path, key, state);
  }

  async read<T>(reader: (state: Readonly<OAuthState>) => T): Promise<T> {
    return this.#mutex.run(async () => reader(this.#state));
  }

  async update<T>(change: (state: OAuthState) => Promise<T> | T): Promise<T> {
    // ponytail: one process and one lock per store; use a transactional database for multiple replicas.
    return this.#mutex.run(async () => {
      const state = structuredClone(this.#state);
      for (const records of [state.pending, state.codes, state.sessions]) {
        for (const [key, value] of Object.entries(records)) {
          if (value.expiresAt <= Date.now()) delete records[key];
        }
      }
      const result = await change(state);
      if (
        [state.pending, state.codes, state.sessions].some(
          (records) => Object.keys(records).length > 1000,
        )
      ) {
        throw new Error("OAuth capacity reached.");
      }
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
      cipher.setAAD(Buffer.from("x-chatgpt-oauth-v1"));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${secret()}.tmp`;
      await writeFile(temporary, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]), {
        mode: 0o600,
      });
      await rename(temporary, this.#path);
      this.#state = state;
      return result;
    });
  }
}
