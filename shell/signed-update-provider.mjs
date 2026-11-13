import { createRequire } from "node:module";
import { matchUpdateInfo, MAX_SIGNED_METADATA_BYTES, verifyUpdateManifest } from "./update-signature.mjs";

const require = createRequire(import.meta.url);
const { GenericProvider } = require("electron-updater/out/providers/GenericProvider.js");

async function readManifest(fetcher, url) {
  const response = await fetcher(url, {signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store"});
  if (!response.ok) throw new Error(`Signed update metadata unavailable (${response.status}).`);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > MAX_SIGNED_METADATA_BYTES) throw new Error("Signed update metadata is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The standard custom-provider API verifies metadata before electron-updater sees availability. */
export function signedUpdateProvider(publicKey, fetcher = fetch) {
  return class SignedUpdateProvider extends GenericProvider {
    #approved;

    async getLatestVersion() {
      this.#approved = undefined;
      const unsigned = await super.getLatestVersion();
      const envelope = await readManifest(fetcher, new URL(`${this.channel}.signed.json`, this.baseUrl));
      const signed = verifyUpdateManifest(envelope, publicKey, this.channel);
      this.#approved = matchUpdateInfo(unsigned, signed);
      return this.#approved;
    }

    resolveFiles(info) {
      if (!this.#approved || info !== this.#approved) throw new Error("Update download requires verified signed metadata.");
      matchUpdateInfo(info, this.#approved);
      return super.resolveFiles(this.#approved);
    }
  };
}
