import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMessagesClient,
  isMessagesEnabled,
  MessagesRequestError,
  MessagesUnavailableError,
  redactShop,
  resetMessagesCircuitBreaker,
  threadSummaryForShop,
  unreadCountForShop,
} from "../src/server/index.js";
import { jsonResponse, mockFetch, thread } from "./helpers.js";

const SHOP = "demo-store.myshopify.com";

beforeEach(() => {
  resetMessagesCircuitBreaker();
  vi.stubEnv("NERDLABS_MESSAGES_KEY", "test-key");
  vi.stubEnv("NERDLABS_MESSAGES_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("isMessagesEnabled", () => {
  it("is true only when the key is set", () => {
    expect(isMessagesEnabled()).toBe(true);
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    expect(isMessagesEnabled()).toBe(false);
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "   ");
    expect(isMessagesEnabled()).toBe(false);
  });
});

describe("createMessagesClient", () => {
  it("throws when no key is available", () => {
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    expect(() => createMessagesClient()).toThrow(TypeError);
  });

  it("GETs the thread with bearer auth, default base URL and a timeout signal", async () => {
    const { calls } = mockFetch(() => jsonResponse(200, thread));
    const result = await createMessagesClient().getThread(SHOP);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(`http://127.0.0.1:3027/admin/api/v1/thread?shop=${encodeURIComponent(SHOP)}`);
    expect(call!.init.method).toBe("GET");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
    expect(call!.init.redirect).toBe("error");
    expect(result.conversation).toEqual(thread.conversation);
    expect(result.messages).toHaveLength(2);
    expect(result.unread).toBe(1);
  });

  it("honours NERDLABS_MESSAGES_URL and explicit options (trailing slash trimmed)", async () => {
    vi.stubEnv("NERDLABS_MESSAGES_URL", "http://10.0.0.5:4000/");
    const { calls } = mockFetch(() => jsonResponse(200, { unread: 3 }));
    expect(await createMessagesClient().getUnread(SHOP)).toBe(3);
    expect(calls[0]!.url).toBe(`http://10.0.0.5:4000/admin/api/v1/unread?shop=${encodeURIComponent(SHOP)}`);

    await createMessagesClient({ apiKey: "other", baseUrl: "http://x.test" }).getUnread(SHOP);
    expect(calls[1]!.url.startsWith("http://x.test/admin/api/v1/unread")).toBe(true);
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer other");
  });

  it("accepts a null conversation and drops malformed messages", async () => {
    mockFetch(() => jsonResponse(200, { conversation: null, messages: [{ id: 1 }, thread.messages[0]], unread: 0 }));
    const result = await createMessagesClient().getThread(SHOP);
    expect(result.conversation).toBeNull();
    expect(result.messages).toEqual([thread.messages[0]]);
  });

  it("POSTs messages as JSON per the contract", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(201, { conversation: thread.conversation, message: thread.messages[0] }),
    );
    const result = await createMessagesClient().postMessage({
      shop: SHOP,
      body: "Help",
      kind: "setup",
      merchantEmail: "a@b.co",
      merchantName: "Ann",
      locale: "de",
    });
    expect(result.message.id).toBe("m1");
    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:3027/admin/api/v1/messages");
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.init.body as string)).toEqual({
      shop: SHOP,
      body: "Help",
      kind: "setup",
      merchantEmail: "a@b.co",
      merchantName: "Ann",
      locale: "de",
    });
  });

  it("marks read and deletes per the contract", async () => {
    const { calls } = mockFetch((url, init) =>
      init.method === "DELETE" ? jsonResponse(200, { deleted: 4 }) : jsonResponse(200, { ok: true }),
    );
    const client = createMessagesClient();
    await client.markRead(SHOP);
    expect(await client.deleteThread(SHOP)).toBe(4);
    expect(calls[0]!.url).toBe("http://127.0.0.1:3027/admin/api/v1/read");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ shop: SHOP });
    expect(calls[1]!.init.method).toBe("DELETE");
    expect(calls[1]!.url).toBe(`http://127.0.0.1:3027/admin/api/v1/thread?shop=${encodeURIComponent(SHOP)}`);
  });

  it("treats a missing/invalid unread or deleted count as malformed (unavailable)", async () => {
    mockFetch(() => jsonResponse(200, { conversation: null, messages: [] }));
    await expect(createMessagesClient().getThread(SHOP)).rejects.toBeInstanceOf(MessagesUnavailableError);
    mockFetch(() => jsonResponse(200, { conversation: null, messages: [], unread: -1 }));
    await expect(createMessagesClient().getThread(SHOP)).rejects.toBeInstanceOf(MessagesUnavailableError);
    mockFetch(() => jsonResponse(200, {}));
    await expect(createMessagesClient().deleteThread(SHOP)).rejects.toBeInstanceOf(MessagesUnavailableError);
    mockFetch(() => jsonResponse(200, { deleted: "3" }));
    await expect(createMessagesClient().deleteThread(SHOP)).rejects.toBeInstanceOf(MessagesUnavailableError);
  });

  it("uses an 8s timeout for postMessage and 3s for everything else", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mockFetch((url) =>
      url.endsWith("/messages")
        ? jsonResponse(201, { conversation: thread.conversation, message: thread.messages[0] })
        : jsonResponse(200, { unread: 0 }),
    );
    const client = createMessagesClient();
    await client.postMessage({ shop: SHOP, body: "x", merchantEmail: "a@b.co" });
    await client.getUnread(SHOP);
    expect(timeout.mock.calls.map((c) => c[0])).toEqual([8000, 3000]);
  });

  it("maps 4xx to MessagesRequestError with status and code", async () => {
    mockFetch(() => jsonResponse(429, { error: "rate_limited" }));
    const error = await createMessagesClient()
      .postMessage({ shop: SHOP, body: "x", merchantEmail: "a@b.co" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MessagesRequestError);
    expect((error as MessagesRequestError).status).toBe(429);
    expect((error as MessagesRequestError).code).toBe("rate_limited");
  });

  it("gives a 4xx without a JSON body an http_<status> code", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    const error = await createMessagesClient().getUnread(SHOP).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MessagesRequestError);
    expect((error as MessagesRequestError).code).toBe("http_404");
  });

  it.each([
    ["5xx", () => jsonResponse(502, { error: "bad_gateway" })],
    ["non-JSON 200", () => new Response("<html>", { status: 200 })],
    ["malformed 200", () => jsonResponse(200, { nope: true })],
  ])("maps %s to MessagesUnavailableError", async (_label, respond) => {
    mockFetch(respond);
    await expect(createMessagesClient().getUnread(SHOP)).rejects.toBeInstanceOf(MessagesUnavailableError);
  });

  it("maps network failure and timeout to MessagesUnavailableError", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(createMessagesClient().getThread(SHOP)).rejects.toBeInstanceOf(MessagesUnavailableError);

    // Real timeout path: a fetch that only settles when its signal aborts.
    mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    await expect(createMessagesClient({ timeoutMs: 50 }).getThread(SHOP)).rejects.toBeInstanceOf(
      MessagesUnavailableError,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("unreadCountForShop", () => {
  it("returns null without calling out when disabled", async () => {
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    const { fn } = mockFetch(() => jsonResponse(200, { unread: 1 }));
    expect(await unreadCountForShop(SHOP)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the count with a 1s timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mockFetch(() => jsonResponse(200, { unread: 2 }));
    expect(await unreadCountForShop(SHOP)).toBe(2);
    expect(timeout).toHaveBeenCalledWith(1000);
  });

  it("returns null on 4xx without tripping the breaker", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(() => jsonResponse(401, { error: "unauthorized" }));
    expect(await unreadCountForShop(SHOP)).toBeNull();
    mockFetch(() => jsonResponse(200, { unread: 4 }));
    expect(await unreadCountForShop(SHOP)).toBe(4);
  });

  it("opens a 60s circuit after an outage and logs once per window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fn } = mockFetch(() => jsonResponse(503, {}));

    expect(await unreadCountForShop(SHOP)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
    // Breaker open: no calls, still null, no extra logs — for both helpers.
    expect(await unreadCountForShop(SHOP)).toBeNull();
    expect(await threadSummaryForShop(SHOP)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-02T12:00:59Z"));
    expect(await unreadCountForShop(SHOP)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);

    // Window over: one probe; still down → re-open and log once more.
    vi.setSystemTime(new Date("2026-10-02T12:01:01Z"));
    expect(await unreadCountForShop(SHOP)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);

    // Recovered after the next window.
    vi.setSystemTime(new Date("2026-10-02T12:02:02Z"));
    mockFetch(() => jsonResponse(200, { unread: 1 }));
    expect(await unreadCountForShop(SHOP)).toBe(1);
  });
});

describe("threadSummaryForShop", () => {
  it("is null when disabled", async () => {
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    const { fn } = mockFetch(() => jsonResponse(200, thread));
    expect(await threadSummaryForShop(SHOP)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: "c", kind: "setup", status: "open" }, true],
    [{ id: "c", kind: "setup", status: "setup_in_progress" }, true],
    [{ id: "c", kind: "setup", status: "closed" }, false],
    [{ id: "c", kind: "message", status: "open" }, false],
    [null, false],
  ])("conversation %j → setupOpen %s", async (conversation, setupOpen) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { calls } = mockFetch(() => jsonResponse(200, { conversation, messages: [], unread: 2 }));
    expect(await threadSummaryForShop(SHOP)).toEqual({ unread: 2, setupOpen });
    expect(calls[0]!.url).toContain("/admin/api/v1/thread?shop=");
    expect(timeout).toHaveBeenCalledWith(1000);
  });

  it("returns null on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await threadSummaryForShop(SHOP)).toBeNull();
  });
});

describe("redactShop", () => {
  it("is a no-op when disabled", async () => {
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    const { fn } = mockFetch(() => jsonResponse(200, { deleted: 0 }));
    await redactShop(SHOP);
    expect(fn).not.toHaveBeenCalled();
  });

  it("deletes the thread", async () => {
    const { calls } = mockFetch(() => jsonResponse(200, { deleted: 1 }));
    await expect(redactShop(SHOP)).resolves.toBeUndefined();
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it.each([
    ["network failure", () => Promise.reject(new TypeError("connect ECONNREFUSED"))],
    ["5xx", () => jsonResponse(500, {})],
    ["401", () => jsonResponse(401, { error: "unauthorized" })],
    ["off-contract body", () => jsonResponse(200, { ok: true })],
  ])("logs and re-throws on %s so the webhook answers non-200", async (_label, respond) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(respond);
    await expect(redactShop(SHOP)).rejects.toBeInstanceOf(Error);
    expect(log).toHaveBeenCalled();
  });
});
