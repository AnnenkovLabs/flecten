import { createHash } from "node:crypto";
import { type DefaultTreeAdapterMap, parse } from "parse5";
import { z } from "zod";
import type { ProviderGatewayInspection as GatewayInspection } from "../../shared/provider-protection";

type Evidence = GatewayInspection["evidence"][number];
type Gateway = GatewayInspection["gateway"];

const publicStatus = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z
    .object({
      version: z.string(),
      start_time: z.number().finite(),
      email_verification: z.boolean(),
      github_oauth: z.boolean(),
      github_client_id: z.string(),
      system_name: z.string(),
      logo: z.string(),
      footer_html: z.string(),
      wechat_qrcode: z.string(),
      wechat_login: z.boolean(),
      server_address: z.string(),
      turnstile_check: z.boolean(),
      turnstile_site_key: z.string(),
      quota_per_unit: z.number().finite(),
      display_in_currency: z.boolean(),
    })
    .passthrough(),
});

const newApiStatus = publicStatus.extend({
  data: publicStatus.shape.data.extend({
    enable_batch_update: z.boolean(),
    enable_drawing: z.boolean(),
    enable_task: z.boolean(),
    enable_data_export: z.boolean(),
    data_export_default_time: z.string(),
    default_collapse_sidebar: z.boolean(),
    mj_notify_enabled: z.boolean(),
  }),
});

const oneApiStatus = publicStatus.extend({
  data: publicStatus.shape.data.extend({
    lark_client_id: z.string(),
    top_up_link: z.string(),
    chat_link: z.string(),
    oidc: z.boolean(),
    oidc_client_id: z.string(),
    oidc_well_known: z.string(),
    oidc_authorization_endpoint: z.string(),
    oidc_token_endpoint: z.string(),
    oidc_userinfo_endpoint: z.string(),
  }),
});

const headerValue = z.string().trim().min(1).max(256);
const cacheVersion = "b688f2fb5be447c25e5aa3bd063087a83db32a288bf6a4f35f2d8db310e40b14";
const assets: ReadonlyMap<string, { gateway: Gateway; name: string }> = new Map([
  [
    "18f33dbe5729c74d8a7f2ee8a7a7cced77e76914e855ca4495d8b65c18eff905",
    { gateway: "new-api", name: "favicon" },
  ],
  [
    "5b20392caae1c558b6d04743f9c0a731237914433c216caf91fd44564a8f5f2b",
    { gateway: "new-api", name: "logo" },
  ],
  [
    "752c8f79e0e4c29601b162dc3e783198a764675ee2f3a7959213ebfe76791c90",
    { gateway: "one-api", name: "favicon" },
  ],
  [
    "c639eb5af36fb48aaa77615aa3824d533bd2d155772f324dcd4bab78b8ea2a24",
    { gateway: "one-api", name: "logo" },
  ],
]);

export function gatewayHeaders(headers: Headers, source: string): Evidence[] {
  const evidence: Evidence[] = [];
  if (headerValue.safeParse(headers.get("x-new-api-version")).success) {
    evidence.push({
      id: "new-api.version-header",
      source,
      detail: "X-New-Api-Version response header is present.",
    });
  }
  if (headerValue.safeParse(headers.get("x-oneapi-request-id")).success) {
    evidence.push({
      id: "family.request-id-header",
      source,
      detail: "X-Oneapi-Request-Id response header is present in both projects and their forks.",
    });
  }
  if (headers.get("cache-version") === cacheVersion) {
    evidence.push({
      id: "new-api.cache-version-header",
      source,
      detail: "Cache-Version matches the pinned New API frontend middleware.",
    });
  }
  return evidence;
}

export function gatewayStatus(bytes: Uint8Array, source: string): Evidence[] {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
  const evidence: Evidence[] = [];
  if (newApiStatus.safeParse(json).success) {
    evidence.push({
      id: "new-api.status-schema",
      source,
      detail:
        "Public status matches the shared relay schema and New API drawing, task and data export fields.",
    });
  }
  if (oneApiStatus.safeParse(json).success) {
    evidence.push({
      id: "one-api.status-schema",
      source,
      detail:
        "Public status matches the shared relay schema and One API Lark, top-up, chat and OIDC fields.",
    });
  }
  if (evidence.length === 0 && publicStatus.safeParse(json).success) {
    evidence.push({
      id: "family.status-schema",
      source,
      detail: "Public status matches the common One API / New API status contract.",
    });
  }
  return evidence;
}

export function gatewayAsset(bytes: Uint8Array, source: string): Evidence[] {
  const asset = assets.get(createHash("sha256").update(bytes).digest("hex"));
  return asset
    ? [
        {
          id: `${asset.gateway}.${asset.name}-asset`,
          source,
          detail: `Static ${asset.name} bytes match the pinned ${asset.gateway} repository. Assets can be copied or replaced.`,
        },
      ]
    : [];
}

type HtmlNode = DefaultTreeAdapterMap["node"];

function text(node: HtmlNode): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(text).join("") : "";
}

export function gatewayBranding(bytes: Uint8Array, source: string): Evidence[] {
  const document = parse(new TextDecoder().decode(bytes));
  const found = new Set<string>();
  const visit = (node: HtmlNode): void => {
    if ("tagName" in node) {
      const attribute = (name: string): string | undefined =>
        node.attrs.find((value) => value.name === name)?.value;
      const label =
        node.tagName === "title"
          ? text(node).trim()
          : node.tagName === "meta" && attribute("name") === "title"
            ? attribute("content")
            : undefined;
      if (label === "New API") found.add("new-api.title");
      if (label === "One API") found.add("one-api.title");
      if (node.tagName === "a") {
        if (attribute("href") === "https://github.com/QuantumNous/new-api")
          found.add("new-api.repository-link");
        if (attribute("href") === "https://github.com/songquanpeng/one-api")
          found.add("one-api.repository-link");
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(document);
  return [...found].map((id) => ({
    id,
    source,
    detail:
      "Page branding matches the pinned project. Branding alone does not identify the API backend.",
  }));
}

export function classifyGateway(
  evidence: Evidence[],
): Pick<GatewayInspection, "gateway" | "confidence"> {
  const has = (id: string): boolean => evidence.some((entry) => entry.id === id);
  const newSchema = has("new-api.status-schema");
  const oneSchema = has("one-api.status-schema");
  const newHeader = has("new-api.version-header");
  const sharedHeader = has("family.request-id-header");
  if (oneSchema && (newSchema || newHeader)) return { gateway: "unknown", confidence: "suspected" };
  if (newHeader) return { gateway: "new-api", confidence: "confirmed" };
  if (newSchema)
    return { gateway: "new-api", confidence: sharedHeader ? "confirmed" : "suspected" };
  if (oneSchema)
    return { gateway: "one-api", confidence: sharedHeader ? "confirmed" : "suspected" };
  if (has("new-api.cache-version-header")) return { gateway: "new-api", confidence: "suspected" };
  if (sharedHeader || has("family.status-schema"))
    return { gateway: "unknown", confidence: "suspected" };
  return { gateway: "unknown", confidence: "unknown" };
}
