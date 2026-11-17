import { describe, expect, test } from "bun:test";
import { ProviderGatewayInspectionSchema } from "../../shared/provider-protection";
import { inspectProviderGateway } from "../../src/providers/gateway-detection";

const commonStatus = {
  version: "v1.0.0",
  start_time: 1730000000,
  email_verification: false,
  github_oauth: false,
  github_client_id: "",
  system_name: "A custom relay name",
  logo: "",
  footer_html: "",
  wechat_qrcode: "",
  wechat_login: false,
  server_address: "https://relay.example",
  turnstile_check: false,
  turnstile_site_key: "",
  quota_per_unit: 500000,
  display_in_currency: true,
};

const newStatus = {
  ...commonStatus,
  enable_batch_update: false,
  enable_drawing: true,
  enable_task: true,
  enable_data_export: true,
  data_export_default_time: "hour",
  default_collapse_sidebar: false,
  mj_notify_enabled: false,
};

const oneStatus = {
  ...commonStatus,
  lark_client_id: "",
  top_up_link: "",
  chat_link: "",
  oidc: false,
  oidc_client_id: "",
  oidc_well_known: "",
  oidc_authorization_endpoint: "",
  oidc_token_endpoint: "",
  oidc_userinfo_endpoint: "",
};

function fakeFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function statusFetch(data: unknown, headers: HeadersInit = {}): typeof fetch {
  return fakeFetch((url) =>
    url.pathname === "/api/status"
      ? Response.json({ success: true, message: "", data }, { headers })
      : new Response("", { status: 404 }),
  );
}

describe("source-backed gateway inspection", () => {
  test("recognizes the explicit New API version header without collecting its value", async () => {
    const result = await inspectProviderGateway("https://relay.example/v1", {
      fetch: fakeFetch(
        () => new Response("", { status: 404, headers: { "X-New-Api-Version": "v0.11.0" } }),
      ),
    });
    expect(result).toMatchObject({ gateway: "new-api", confidence: "confirmed" });
    expect(result.evidence.some((entry) => entry.id === "new-api.version-header")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("v0.11.0");
    expect(ProviderGatewayInspectionSchema.safeParse(result).success).toBe(true);
  });

  test("requires typed status contracts and corroborates them with the shared request header", async () => {
    for (const [data, gateway] of [
      [newStatus, "new-api"],
      [oneStatus, "one-api"],
    ] as const) {
      const result = await inspectProviderGateway("https://relay.example/v1/", {
        fetch: statusFetch(data, { "X-Oneapi-Request-Id": "fixture-id" }),
      });
      expect(result).toMatchObject({ gateway, confidence: "confirmed" });
      expect(result.evidence.some((entry) => entry.id === `${gateway}.status-schema`)).toBe(true);
    }
    const uncorroborated = await inspectProviderGateway("https://relay.example/v1", {
      fetch: statusFetch(oneStatus),
    });
    expect(uncorroborated).toMatchObject({ gateway: "one-api", confidence: "suspected" });
    const malformed = await inspectProviderGateway("https://relay.example/v1", {
      fetch: statusFetch({ ...newStatus, quota_per_unit: "500000" }),
    });
    expect(malformed).toMatchObject({ gateway: "unknown", confidence: "unknown" });
  });

  test("does not call the shared request header One API or treat unknown as safe", async () => {
    const result = await inspectProviderGateway("https://relay.example/v1", {
      fetch: fakeFetch(() => new Response("", { headers: { "X-Oneapi-Request-Id": "fixture" } })),
    });
    expect(result).toMatchObject({ gateway: "unknown", confidence: "suspected" });
    const common = await inspectProviderGateway("https://relay.example/v1", {
      fetch: statusFetch(commonStatus),
    });
    expect(common).toMatchObject({ gateway: "unknown", confidence: "suspected" });
  });

  test("records exact parsed HTML branding without promoting it to backend identification", async () => {
    const requests: string[] = [];
    const result = await inspectProviderGateway("https://relay.example/v1", {
      fetch: fakeFetch((url) => {
        requests.push(url.href);
        return new Response(
          '<title>New API</title><a href="https://github.com/QuantumNous/new-api">Source</a><script src="https://tracker.example/collect"></script><link rel="icon" href="https://tracker.example/icon">',
        );
      }),
    });
    expect(result).toMatchObject({ gateway: "unknown", confidence: "unknown" });
    expect(result.evidence.some((entry) => entry.id === "new-api.title")).toBe(true);
    expect(result.evidence.some((entry) => entry.id === "new-api.repository-link")).toBe(true);
    expect(requests.every((url) => new URL(url).origin === "https://relay.example")).toBe(true);
    expect(requests).toHaveLength(4);
  });

  test("never follows redirects, uses credentials, forwards queries or sends custom auth", async () => {
    const requests: string[] = [];
    const result = await inspectProviderGateway(
      "https://relay.example/proxy/v1?api_key=secret#private",
      {
        fetch: fakeFetch((url, init) => {
          requests.push(url.href);
          expect(init?.method).toBe("GET");
          expect(init?.redirect).toBe("manual");
          expect(init?.credentials).toBe("omit");
          expect(init?.referrerPolicy).toBe("no-referrer");
          expect([...new Headers(init?.headers).keys()]).toEqual(["accept"]);
          return new Response("", {
            status: 302,
            headers: { Location: "https://other.example/steal" },
          });
        }),
      },
    );
    expect(result).toMatchObject({ gateway: "unknown", confidence: "unknown" });
    expect(requests).toContain("https://relay.example/proxy/api/status");
    expect(requests).toContain("https://relay.example/api/status");
    expect(requests).toHaveLength(6);
    expect(requests.every((url) => !url.includes("secret") && !url.includes("private"))).toBe(true);
    expect(result.evidence.every((entry) => entry.id === "probe.redirect")).toBe(true);
  });

  test("rejects embedded credentials and non-HTTP URLs without network calls", async () => {
    for (const url of ["https://user:password@relay.example/v1", "file:///tmp/.env", "not a URL"]) {
      let called = false;
      const result = await inspectProviderGateway(url, {
        fetch: fakeFetch(() => {
          called = true;
          return new Response();
        }),
      });
      expect(called).toBe(false);
      expect(result.evidence[0]?.id).toBe("probe.invalid-url");
      expect(JSON.stringify(result)).not.toContain("password");
    }
  });

  test("preserves header evidence when an oversized body is rejected", async () => {
    const result = await inspectProviderGateway("https://relay.example/v1", {
      fetch: fakeFetch(
        () =>
          new Response("X".repeat(128 * 1024 + 1), { headers: { "X-New-Api-Version": "fixture" } }),
      ),
    });
    expect(result).toMatchObject({ gateway: "new-api", confidence: "confirmed" });
    expect(result.evidence.some((entry) => entry.id === "probe.unavailable")).toBe(true);
  });

  test("cancels hanging reads and requests without waiting for the remote peer", async () => {
    const controller = new AbortController();
    const inspection = inspectProviderGateway("https://relay.example/v1", {
      signal: controller.signal,
      fetch: fakeFetch((url) =>
        url.pathname === "/api/status"
          ? new Promise<Response>(() => undefined)
          : new Response(
              new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }),
            ),
      ),
    });
    controller.abort();
    const result = await inspection;
    expect(result.evidence.every((entry) => entry.id === "probe.cancelled")).toBe(true);
    expect(result).toMatchObject({ gateway: "unknown", confidence: "unknown" });
  });

  test("keeps conflicting signatures unresolved", async () => {
    const result = await inspectProviderGateway("https://relay.example/v1", {
      fetch: statusFetch({ ...newStatus, ...oneStatus }, { "X-Oneapi-Request-Id": "fixture" }),
    });
    expect(result).toMatchObject({ gateway: "unknown", confidence: "suspected" });
  });
});
