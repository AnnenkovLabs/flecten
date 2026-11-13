import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactName, trustedUpdateKey, validatedUpdateInfo } from "../shell/update-signature.mjs";

/** Public material is pinned at packaging time; runtime never reads a key from the feed. */
export async function pinUpdateKey(publicKey, path) {
  const key = trustedUpdateKey(publicKey);
  await writeFile(path, key.export({ type: "spki", format: "pem" }), { mode: 0o644 });
}

export async function signUpdateManifests({ directory, privateKey, publicKey, version }) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Update private signing key must be Ed25519.");
  const pinned = trustedUpdateKey(publicKey).export({ type: "spki", format: "der" });
  if (!createPublicKey(key).export({ type: "spki", format: "der" }).equals(pinned))
    throw new Error("Private update key does not match the pinned public key.");
  const written = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".yml")) continue;
    const metadata = Bun.YAML.parse(await readFile(join(directory, name), "utf8"));
    if (!metadata?.version || !metadata?.files) continue;
    const info = validatedUpdateInfo(metadata);
    if (info.version !== version)
      throw new Error(`Update metadata ${name} version does not match ${version}.`);
    for (const file of info.files) {
      const path = join(directory, artifactName(file.url));
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size)
        throw new Error(`Artifact ${file.url} is missing or its size changed.`);
      const digest = createHash("sha512");
      for await (const chunk of createReadStream(path)) digest.update(chunk);
      if (digest.digest("base64") !== file.sha512)
        throw new Error(`Artifact ${file.url} SHA512 does not match release metadata.`);
    }
    const payload = JSON.stringify({
      schemaVersion: 1,
      channel: name.slice(0, -4),
      updateInfo: info,
    });
    const envelope = {
      payload,
      signature: sign(null, Buffer.from(payload), key).toString("base64"),
    };
    const path = join(directory, `${name.slice(0, -4)}.signed.json`);
    await writeFile(path, `${JSON.stringify(envelope)}\n`);
    written.push(path);
  }
  if (written.length === 0) throw new Error("No update metadata found to sign.");
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const publicKey = process.env.UPDATE_SIGNING_PUBLIC_KEY;
  if (process.argv.includes("--pin")) {
    const pin = join(root, "shell/update-public-key.pem");
    if (publicKey) await pinUpdateKey(publicKey, pin);
    else {
      await rm(pin, { force: true });
      console.log("Update signing public key is absent. This build will reject updates.");
    }
  } else {
    if (!publicKey || !process.env.UPDATE_SIGNING_PRIVATE_KEY) {
      await writeFile(
        join(root, "release/UNSIGNED-updates.txt"),
        "Update manifests are unsigned: configure UPDATE_SIGNING_PUBLIC_KEY and UPDATE_SIGNING_PRIVATE_KEY in CI. This build rejects unsigned updates.\n",
      );
      console.log("UNSIGNED updates: signing keys are absent; no signed update channel published.");
      process.exit(0);
    }
    const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const files = await signUpdateManifests({
      directory: join(root, "release"),
      privateKey: process.env.UPDATE_SIGNING_PRIVATE_KEY,
      publicKey,
      version,
    });
    console.log(`Signed ${files.length} update manifests.`);
  }
}
