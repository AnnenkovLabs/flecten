import { createPublicKey, verify } from "node:crypto";

export const MAX_SIGNED_METADATA_BYTES = 256 * 1024;

export function trustedUpdateKey(pem) {
  if (typeof pem !== "string" || !pem.trim()) throw new Error("A pinned update signing key is required.");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Update signing key must be Ed25519.");
  return key;
}

export function artifactName(value) {
  if (typeof value !== "string" || !value || value.length > 255 || value === "." || value === "..")
    throw new Error("Invalid update artifact name.");
  for (const char of value) {
    if ("/\\%?#:".includes(char) || char.charCodeAt(0) < 32) throw new Error("Update artifacts must use plain file names.");
  }
  return value;
}

function checksum(value) {
  if (typeof value !== "string") throw new Error("Update artifact requires SHA512.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) throw new Error("Invalid update SHA512.");
  return value;
}

export function validatedUpdateInfo(value) {
  if (!value || typeof value !== "object" || typeof value.version !== "string" || !value.version || value.version.length > 128)
    throw new Error("Invalid signed update version.");
  if (value.packages != null) throw new Error("Signed updates do not support web installer packages.");
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 32)
    throw new Error("Signed update requires an artifact list.");
  const files = value.files.map((file) => {
    if (!file || typeof file !== "object" || !Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error("Invalid signed update artifact size.");
    return Object.freeze({url: artifactName(file.url), sha512: checksum(file.sha512), size: file.size});
  });
  if (new Set(files.map((file) => file.url)).size !== files.length) throw new Error("Duplicate update artifact.");
  return Object.freeze({version: value.version, files: Object.freeze(files)});
}

export function verifyUpdateManifest(envelope, publicKey, channel) {
  if (!envelope || typeof envelope !== "object" || typeof envelope.payload !== "string" || typeof envelope.signature !== "string")
    throw new Error("Update metadata is unsigned.");
  if (Buffer.byteLength(envelope.payload) > MAX_SIGNED_METADATA_BYTES) throw new Error("Signed update metadata is too large.");
  const signature = Buffer.from(envelope.signature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== envelope.signature || !verify(null, Buffer.from(envelope.payload), publicKey, signature))
    throw new Error("Update metadata signature is invalid.");
  const payload = JSON.parse(envelope.payload);
  if (payload.schemaVersion !== 1 || payload.channel !== channel) throw new Error("Signed update channel does not match.");
  return validatedUpdateInfo(payload.updateInfo);
}

/** Compare every download field, then use only the immutable signed snapshot. */
export function matchUpdateInfo(unsigned, signed) {
  const info = validatedUpdateInfo(unsigned);
  if (info.version !== signed.version || info.files.length !== signed.files.length || info.files.some((file, index) => {
    const expected = signed.files[index];
    return file.url !== expected.url || file.sha512 !== expected.sha512 || file.size !== expected.size;
  })) throw new Error("Update version or artifact checksum does not match the signed manifest.");
  return signed;
}
