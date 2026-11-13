import { describe, expect, test } from "bun:test";
import {
  createProviderFetch,
  isSecretHeader,
  parseRetryAfterMs,
  prepareHeaders,
  TransportError,
} from "../../src/providers/transport";

const hangingFetch = ((_input: string | URL | Request, init?: BunFetchRequestInit) => {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}) as typeof fetch;

async function withFetch<T>(replacement: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function captureError(run: () => Promise<unknown>): Promise<TransportError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof TransportError) return error;
    throw error;
  }
  throw new Error("expected a TransportError");
}

function captureSyncError(run: () => unknown): TransportError {
  try {
    run();
  } catch (error) {
    if (error instanceof TransportError) return error;
    throw error;
  }
  throw new Error("expected a TransportError");
}

describe("provider transport headers", () => {
  test("merges headers case-insensitively and redacts secret values", () => {
    const base = {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-live-123456789",
      Cookie: "session=abc",
    };
    const extra = {
      authorization: "Bearer sk-live-999999999",
      "X-Api-Key": "key-123",
      "api-key": "key-456",
      "Proxy-Authorization": "Basic abc",
    };
    const snapshot = structuredClone(base);

    const prepared = prepareHeaders(base, extra);

    expect(base).toEqual(snapshot);
    expect(prepared.headers.authorization).toBe("Bearer sk-live-999999999");
    expect(prepared.headers.Authorization).toBeUndefined();
    expect(prepared.redacted.authorization).toBe("[redacted]");
    expect(prepared.redacted["X-Api-Key"]).toBe("[redacted]");
    expect(prepared.redacted["api-key"]).toBe("[redacted]");
    expect(prepared.redacted["Proxy-Authorization"]).toBe("[redacted]");
    expect(prepared.redacted.Cookie).toBe("[redacted]");
    expect(prepared.redacted["Content-Type"]).toBe("application/json");

    const serialized = JSON.stringify(prepared.redacted);
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("key-123");
    expect(serialized).not.toContain("session=abc");
  });

  test("detects secret header names case-insensitively", () => {
    for (const name of [
      "authorization",
      "Authorization",
      "X-API-KEY",
      "api-key",
      "Proxy-Authorization",
      "cookie",
    ]) {
      expect(isSecretHeader(name)).toBe(true);
    }
    for (const name of ["content-type", "x-request-id", "x-api-key-id"]) {
      expect(isSecretHeader(name)).toBe(false);
    }
  });

  test("uses the Bun proxy option and merges request headers", async () => {
    let seen: BunFetchRequestInit | undefined;
    const fake = ((_input: string | URL | Request, init?: BunFetchRequestInit) => {
      seen = init;
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    const response = await withFetch(fake, async () => {
      const transport = createProviderFetch({
        proxy: "http://127.0.0.1:3128",
        headers: { "X-Tenant": "a", Authorization: "Bearer base" },
      });
      return transport("https://example.com", {
        headers: { authorization: "Bearer call", "X-Trace": "t" },
      });
    });

    expect(await response.text()).toBe("ok");
    expect(seen?.proxy).toBe("http://127.0.0.1:3128");
    expect(seen?.redirect).toBe("follow");
    expect(seen?.headers).toEqual({
      "X-Tenant": "a",
      authorization: "Bearer call",
      "X-Trace": "t",
    });
  });

  test("passes TLS options through to fetch", async () => {
    let seen: BunFetchRequestInit | undefined;
    const fake = ((_input: string | URL | Request, init?: BunFetchRequestInit) => {
      seen = init;
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    await withFetch(fake, async () => {
      const transport = createProviderFetch({ tls: { rejectUnauthorized: false } });
      await transport("https://example.com");
    });

    expect(seen?.tls).toEqual({ rejectUnauthorized: false });
  });

  test("never puts header secrets into transport errors", async () => {
    const secret = "plain-secret-value-42";
    const fake = (() =>
      Promise.resolve(
        new Response(`upstream said ${secret}`, { status: 401 }),
      )) as unknown as typeof fetch;

    const error = await withFetch(fake, () =>
      captureError(async () => {
        const transport = createProviderFetch({
          headers: { Authorization: `Bearer ${secret}`, "X-Api-Key": "header-key-77" },
        });
        await transport("https://example.com");
      }),
    );

    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.bodyText).not.toContain(secret);
    expect(error.bodyText).toContain("[redacted]");
    expect(error.message).not.toContain(secret);
  });
});

describe("provider transport proxy validation", () => {
  test("rejects socks and other non-http proxies with a Russian typed error", () => {
    for (const proxy of [
      "socks5://127.0.0.1:1080",
      "socks5h://127.0.0.1:1080",
      "ftp://127.0.0.1:21",
    ]) {
      const error = captureSyncError(() => createProviderFetch({ proxy }));
      expect(error.reason).toBe("proxy");
      expect(error.code).toBe("invalid_input");
      expect(error.message).toContain("не поддерживается");
      expect(error.message).toContain(proxy.slice(0, proxy.indexOf(":")));
    }

    expect(() => createProviderFetch({ proxy: "http://127.0.0.1:3128" })).not.toThrow();
    expect(() =>
      createProviderFetch({ proxy: new URL("https://proxy.example.com") }),
    ).not.toThrow();
  });

  test("rejects malformed proxy urls", () => {
    const error = captureSyncError(() => createProviderFetch({ proxy: "not a url" }));
    expect(error.reason).toBe("proxy");
    expect(error.message).toContain("Некорректный URL прокси");
  });
});

describe("provider transport failures", () => {
  test("aborts a slow request with a typed timeout error", async () => {
    const error = await withFetch(hangingFetch, () =>
      captureError(async () => {
        const transport = createProviderFetch({ timeoutMs: 25 });
        await transport("https://example.com");
      }),
    );

    expect(error.reason).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.status).toBeUndefined();
    expect(error.message).toContain("25");
  });

  test("reports caller cancellation as aborted", async () => {
    const controller = new AbortController();
    const error = await withFetch(hangingFetch, () =>
      captureError(async () => {
        const transport = createProviderFetch({ timeoutMs: 5_000 });
        const request = transport("https://example.com", { signal: controller.signal });
        setTimeout(() => controller.abort(), 5);
        await request;
      }),
    );

    expect(error.reason).toBe("aborted");
    expect(error.retryable).toBe(false);
  });

  test("parses retry after seconds and dates", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  test("carries status, retry flag, retry after and body text", async () => {
    const fake = (() =>
      Promise.resolve(
        new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
      )) as unknown as typeof fetch;

    const error = await withFetch(fake, () =>
      captureError(async () => {
        const transport = createProviderFetch();
        await transport("https://example.com");
      }),
    );

    expect(error.reason).toBe("http");
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2000);
    expect(error.bodyText).toBe("slow down");
  });
});
