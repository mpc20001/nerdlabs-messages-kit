import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetch as remixPolyfillFetch } from "@remix-run/web-fetch";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createMessagesClient,
  MessagesRequestError,
  MessagesUnavailableError,
  resetMessagesCircuitBreaker,
  unreadCountForShop,
} from "../src/server/index.js";

/**
 * Real-socket check against a minimal fake of the service (API.md), using the
 * runtime's real fetch (and Remix's web-fetch polyfill), timeouts and redirect handling.
 */
let server: Server;
let baseUrl: string;
const seen: { method: string; url: string; auth: string | undefined; body: string; xff: string | undefined }[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      auth: req.headers.authorization,
      body,
      xff: req.headers["x-forwarded-for"] as string | undefined,
    });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== "Bearer good") return send(401, { error: "unauthorized" });
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/admin/api/v1/slow") return; // never answers
    if (url.pathname === "/admin/api/v1/unread") {
      if (url.searchParams.get("shop") === "redirect.myshopify.com") {
        res.writeHead(302, { Location: "http://example.com/" });
        return res.end();
      }
      return send(200, { unread: 5 });
    }
    if (url.pathname === "/admin/api/v1/messages" && req.method === "POST") {
      return send(429, { error: "rate_limited" });
    }
    return send(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("client over real HTTP", () => {
  it("authenticates, sends no proxy headers, parses results", async () => {
    const client = createMessagesClient({ apiKey: "good", baseUrl });
    expect(await client.getUnread("demo.myshopify.com")).toBe(5);
    const last = seen[seen.length - 1]!;
    expect(last.url).toBe("/admin/api/v1/unread?shop=demo.myshopify.com");
    expect(last.auth).toBe("Bearer good");
    expect(last.xff).toBeUndefined();
  });

  it("surfaces 401 and 429 as MessagesRequestError", async () => {
    await expect(createMessagesClient({ apiKey: "bad", baseUrl }).getUnread("d.myshopify.com")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    const error = await createMessagesClient({ apiKey: "good", baseUrl })
      .postMessage({ shop: "d.myshopify.com", body: "x", merchantEmail: "a@b.co" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MessagesRequestError);
    expect((error as MessagesRequestError).code).toBe("rate_limited");
  });

  it("does not follow redirects", async () => {
    await expect(
      createMessagesClient({ apiKey: "good", baseUrl }).getUnread("redirect.myshopify.com"),
    ).rejects.toBeInstanceOf(MessagesUnavailableError);
  });

  it("times out", async () => {
    const client = createMessagesClient({ apiKey: "good", baseUrl: `${baseUrl}/admin/api/v1/slow#`, timeoutMs: 100 });
    const started = Date.now();
    await expect(client.getUnread("d.myshopify.com")).rejects.toBeInstanceOf(MessagesUnavailableError);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("connection refused is unavailable", async () => {
    await expect(
      createMessagesClient({ apiKey: "good", baseUrl: "http://127.0.0.1:1" }).getUnread("d.myshopify.com"),
    ).rejects.toBeInstanceOf(MessagesUnavailableError);
  });
});

/**
 * Consuming apps run under remix-serve with Remix's web-fetch polyfill. Its
 * abort path cancels a locked request body without awaiting it — an unowned
 * TypeError that kills the process. A hung service must therefore resolve as
 * "unavailable" within the timeout with NO unhandled rejection (vitest fails
 * the run on one), for requests with a body in particular.
 */
describe.each([
  ["runtime fetch", globalThis.fetch],
  ["Remix web-fetch polyfill", remixPolyfillFetch as unknown as typeof fetch],
])("hung service via %s", (_label, fetchImpl) => {
  const hung = () => `${baseUrl}/admin/api/v1/slow#`;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POST /messages (with a body) times out as unavailable", async () => {
    const client = createMessagesClient({ apiKey: "good", baseUrl: hung(), fetch: fetchImpl, postTimeoutMs: 150 });
    const started = Date.now();
    await expect(
      client.postMessage({ shop: "d.myshopify.com", body: "help", merchantEmail: "a@b.co" }),
    ).rejects.toBeInstanceOf(MessagesUnavailableError);
    expect(Date.now() - started).toBeLessThan(1500);
    // Let any late cancel/settlement surface while the test is still running.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it("POST /read (with a body) times out as unavailable", async () => {
    const client = createMessagesClient({ apiKey: "good", baseUrl: hung(), fetch: fetchImpl, timeoutMs: 150 });
    await expect(client.markRead("d.myshopify.com")).rejects.toBeInstanceOf(MessagesUnavailableError);
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it("unreadCountForShop resolves null within its 1s budget", async () => {
    resetMessagesCircuitBreaker();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "good");
    vi.stubEnv("NERDLABS_MESSAGES_URL", hung());
    vi.stubGlobal("fetch", fetchImpl);
    const started = Date.now();
    expect(await unreadCountForShop("d.myshopify.com")).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    vi.mocked(console.error).mockRestore();
    resetMessagesCircuitBreaker();
  });
});
