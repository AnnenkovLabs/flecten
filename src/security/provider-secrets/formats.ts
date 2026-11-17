/** Credential formats are checked only at the outbound model data boundary. */
const PREFIXES: ReadonlyArray<readonly [string, number, string]> = [
  ["sk-", 16, "_-"],
  ["ghp_", 20, ""],
  ["gho_", 20, ""],
  ["ghu_", 20, ""],
  ["ghs_", 20, ""],
  ["ghr_", 20, ""],
  ["github_pat_", 20, "_"],
  ["AIza", 35, "_-"],
  ["xoxb-", 16, "-"],
  ["xoxp-", 16, "-"],
  ["xoxa-", 16, "-"],
  ["xoxr-", 16, "-"],
  ["xapp-", 16, "-"],
  ["sk_live_", 16, ""],
  ["sk_test_", 16, ""],
  ["rk_live_", 16, ""],
  ["rk_test_", 16, ""],
  ["npm_", 20, ""],
  ["pypi-", 20, "_-"],
  ["glpat-", 20, "_-"],
  ["hf_", 20, ""],
  ["dop_v1_", 32, ""],
  ["dapi", 32, ""],
  ["lin_api_", 20, ""],
  ["sq0atp-", 20, "_-"],
  ["sq0csp-", 20, "_-"],
];
const AWS_PREFIXES = new Set(["AKIA", "ASIA", "AIDA", "AROA", "AIPA", "ANPA", "ANVA", "ASCA"]);
const PEM_KINDS = ["", "RSA ", "EC ", "DSA ", "OPENSSH ", "ENCRYPTED "];

export function asciiAlphaNumeric(char: string): boolean {
  return (
    (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || (char >= "0" && char <= "9")
  );
}

function alphabet(value: string, extra: string): boolean {
  return (
    value.length > 0 && [...value].every((char) => asciiAlphaNumeric(char) || extra.includes(char))
  );
}

function jwt(value: string): boolean {
  const segments = value.split(".");
  if (segments.length !== 3 || !segments.every((part) => alphabet(part, "_-"))) return false;
  try {
    const header: unknown = JSON.parse(Buffer.from(segments[0] ?? "", "base64url").toString());
    const payload: unknown = JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString());
    return (
      typeof header === "object" &&
      header !== null &&
      "alg" in header &&
      typeof header.alg === "string" &&
      typeof payload === "object" &&
      payload !== null
    );
  } catch {
    return false;
  }
}

export function credentialToken(value: string): boolean {
  for (const [prefix, minimum, extra] of PREFIXES) {
    if (!value.startsWith(prefix)) continue;
    const suffix = value.slice(prefix.length);
    if (suffix.length >= minimum && alphabet(suffix, extra)) return true;
  }
  if (value.length === 20 && AWS_PREFIXES.has(value.slice(0, 4))) {
    return [...value].every((char) => (char >= "A" && char <= "Z") || (char >= "0" && char <= "9"));
  }
  if (value.startsWith("SG.")) {
    const segments = value.split(".");
    if (
      segments.length === 3 &&
      segments.slice(1).every((part) => part.length >= 16 && alphabet(part, "_-"))
    )
      return true;
  }
  return value.startsWith("eyJ") && jwt(value);
}

export function privateKeys(text: string): string[] {
  const values: string[] = [];
  for (const kind of PEM_KINDS) {
    const begin = `-----BEGIN ${kind}PRIVATE KEY-----`;
    const end = `-----END ${kind}PRIVATE KEY-----`;
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(begin, cursor);
      if (start < 0) break;
      const close = text.indexOf(end, start + begin.length);
      const finish = close < 0 ? text.length : close + end.length;
      values.push(text.slice(start, finish));
      cursor = finish;
    }
  }
  return values;
}

export function tokenSecrets(text: string): string[] {
  const values: string[] = [];
  let token = "";
  const flush = () => {
    let candidate = token;
    while (candidate.endsWith(".")) candidate = candidate.slice(0, -1);
    if (credentialToken(candidate)) values.push(candidate);
    token = "";
  };
  for (const char of text) {
    if (asciiAlphaNumeric(char) || "_-.".includes(char)) token += char;
    else flush();
  }
  flush();
  return values;
}
