import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const SPDX_ID = /^[A-Za-z0-9.+-]+$/;

function stripJsonc(text) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    result += char;
  }
  return result;
}

function splitPackageSpec(spec) {
  const start = spec.startsWith("@") ? 1 : 0;
  const separator = spec.indexOf("@", start);
  if (separator <= 0) return null;
  const name = spec.slice(0, separator);
  const version = spec.slice(separator + 1);
  if (name.length === 0 || version.length === 0) return null;
  return { name, version };
}

export function parseBunLock(text) {
  const data = JSON.parse(stripJsonc(text));
  const packages = data && typeof data === "object" && data.packages ? data.packages : {};
  const components = new Map();
  for (const entry of Object.values(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const parsed = splitPackageSpec(entry[0]);
    if (!parsed) continue;
    const key = `${parsed.name}@${parsed.version}`;
    if (!components.has(key)) components.set(key, parsed);
  }
  return [...components.values()];
}

function normalizeLicenses(value) {
  const items = Array.isArray(value) ? value : [value];
  const licenses = [];
  for (const item of items) {
    const text =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && typeof item.type === "string"
          ? item.type.trim()
          : "";
    if (text.length > 0 && !licenses.includes(text)) licenses.push(text);
  }
  return licenses;
}

function readLicenses(rootDir, name) {
  if (!PACKAGE_NAME.test(name)) return [];
  try {
    const file = join(rootDir, "node_modules", ...name.split("/"), "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    return normalizeLicenses(pkg.license ?? pkg.licenses);
  } catch {
    return [];
  }
}

function licenseEntries(licenses) {
  return licenses.map((text) =>
    SPDX_ID.test(text) ? { license: { id: text } } : { license: { name: text } },
  );
}

function encodePurlName(name) {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash > 0) {
      return `%40${encodeURIComponent(name.slice(1, slash))}/${encodeURIComponent(name.slice(slash + 1))}`;
    }
  }
  return encodeURIComponent(name);
}

function purl(name, version) {
  return `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(version)}`;
}

export function buildSbom({ packageJson, lockText, rootDir = process.cwd(), now = new Date() }) {
  const root = {
    type: "application",
    name: typeof packageJson.name === "string" ? packageJson.name : "flecten",
    version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
  };
  const rootLicenses = normalizeLicenses(packageJson.license ?? packageJson.licenses);
  if (rootLicenses.length > 0) root.licenses = licenseEntries(rootLicenses);

  const components = parseBunLock(lockText).map(({ name, version }) => {
    const ref = purl(name, version);
    const component = {
      type: "library",
      "bom-ref": ref,
      name,
      version,
      purl: ref,
    };
    const licenses = readLicenses(rootDir, name);
    if (licenses.length > 0) component.licenses = licenseEntries(licenses);
    return component;
  });

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: now.toISOString(),
      tools: {
        components: [{ type: "application", name: "flecten-sbom" }],
      },
      component: root,
    },
    components,
  };
}

export function generateSbom({
  rootDir = resolve(import.meta.dir, ".."),
  outFile = join(rootDir, "release", "sbom.json"),
} = {}) {
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const lockText = readFileSync(join(rootDir, "bun.lock"), "utf8");
  const sbom = buildSbom({ packageJson, lockText, rootDir });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(sbom, null, 2)}\n`);
  return sbom;
}

if (import.meta.main) {
  const sbom = generateSbom();
  console.log(`wrote release/sbom.json with ${sbom.components.length} components`);
}
