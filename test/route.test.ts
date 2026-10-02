import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagesRoute, shopContact, type MessagesAuthResult } from "../src/server/index.js";
import type { MessagesActionData, MessagesLoaderData } from "../src/types.js";
import { jsonResponse, mockFetch, thread } from "./helpers.js";

const SHOP = "demo-store.myshopify.com";

function adminWith(shop: Record<string, unknown> | null, opts: { throws?: boolean } = {}) {
  return {
    graphql: vi.fn(async () => {
      if (opts.throws) throw new Error("graphql down");
      return { json: async () => ({ data: { shop } }) };
    }),
  };
}

function setup(admin = adminWith({ email: "owner@shop.test", name: "Demo Store", shopOwnerName: "Ann Owner", contactEmail: "" })) {
  const authenticate = vi.fn(async (): Promise<MessagesAuthResult> => ({ admin, session: { shop: SHOP } }));
  const route = messagesRoute({ app: "QuickFiles", authenticate });
  return { route, authenticate, admin };
}

function post(fields: Record<string, string>, url = "https://app.test/app/messages") {
  return new Request(url, { method: "POST", body: new URLSearchParams(fields) });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(() => {
  vi.stubEnv("NERDLABS_MESSAGES_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shopContact", () => {
  it("prefers contactEmail over email and owner name over shop name", async () => {
    const contact = await shopContact(
      adminWith({ email: "acct@x.test", contactEmail: "support@x.test", name: "X", shopOwnerName: "Xavier" }),
    );
    expect(contact).toEqual({ email: "support@x.test", name: "Xavier" });
  });

  it("never throws", async () => {
    expect(await shopContact(adminWith(null, { throws: true }))).toEqual({ email: "", name: "" });
    expect(await shopContact(adminWith(null))).toEqual({ email: "", name: "" });
    expect(await shopContact(undefined)).toEqual({ email: "", name: "" });
  });
});

describe("loader", () => {
  it("returns enabled:false and makes no calls when disabled", async () => {
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    const { fn } = mockFetch(() => jsonResponse(200, thread));
    const { route, admin } = setup();
    const res = await route.loader({ request: new Request("https://app.test/app/messages") });
    expect(await body<MessagesLoaderData>(res)).toEqual({ enabled: false });
    expect(fn).not.toHaveBeenCalled();
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("returns the thread, contact and locale, and marks read when unread > 0", async () => {
    const { calls } = mockFetch((url) => (url.includes("/read") ? jsonResponse(200, { ok: true }) : jsonResponse(200, thread)));
    const { route } = setup();
    const res = await route.loader({ request: new Request("https://app.test/app/messages?locale=pt-PT") });
    const data = await body<MessagesLoaderData>(res);
    expect(data).toMatchObject({
      enabled: true,
      conversation: thread.conversation,
      unread: 1,
      contact: { email: "owner@shop.test", name: "Ann Owner" },
      locale: "pt-PT",
      app: "QuickFiles",
    });
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/admin/api/v1/read"))).toBe(true));
  });

  it("does not mark read when nothing is unread, and uses getLocale", async () => {
    const { calls } = mockFetch(() => jsonResponse(200, { ...thread, unread: 0 }));
    const route = messagesRoute({
      app: "SmartOptions",
      authenticate: async () => ({ admin: adminWith({}), session: { shop: SHOP } }),
      getLocale: async (_request, session) => (session.shop === SHOP ? "zh-Hant" : "en"),
    });
    const data = await body<MessagesLoaderData>(await route.loader({ request: new Request("https://app.test/app/messages") }));
    expect(data).toMatchObject({ enabled: true, locale: "zh-TW" });
    expect(calls.every((c) => !c.url.endsWith("/read"))).toBe(true);
  });

  it("a failing markRead never fails the loader", async () => {
    mockFetch((url) => (url.endsWith("/read") ? Promise.reject(new TypeError("boom")) : jsonResponse(200, thread)));
    const { route } = setup();
    const res = await route.loader({ request: new Request("https://app.test/app/messages") });
    expect(res.status).toBe(200);
    expect((await body<MessagesLoaderData>(res)).enabled).toBe(true);
  });

  it("fails open with unavailable:true on service errors (5xx, timeout, 401)", async () => {
    for (const respond of [
      () => jsonResponse(503, {}),
      () => {
        throw new TypeError("fetch failed");
      },
      () => jsonResponse(401, { error: "unauthorized" }),
    ]) {
      mockFetch(respond);
      const { route } = setup();
      const res = await route.loader({ request: new Request("https://app.test/app/messages?locale=de") });
      expect(res.status).toBe(200);
      expect(await body<MessagesLoaderData>(res)).toEqual({ enabled: true, unavailable: true, locale: "de" });
    }
  });

  it("lets Shopify auth responses thrown by authenticate propagate", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    const route = messagesRoute({
      app: "X",
      authenticate: async () => {
        throw redirect;
      },
    });
    await expect(route.loader({ request: new Request("https://app.test/app/messages") })).rejects.toBe(redirect);
    await expect(route.action({ request: post({ intent: "send", body: "hi" }) })).rejects.toBe(redirect);
  });
});

describe("action", () => {
  it("sends a message with the composer's email", async () => {
    const { calls } = mockFetch(() => jsonResponse(201, { conversation: thread.conversation, message: thread.messages[0] }));
    const { route, admin } = setup();
    const res = await route.action({
      request: post({ intent: "send", body: "  Need help  ", merchantEmail: "me@shop.test", merchantName: "Me" }, "https://app.test/app/messages?locale=fr-CA"),
    });
    expect(res.status).toBe(200);
    expect(await body<MessagesActionData>(res)).toEqual({ ok: true, intent: "send" });
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      shop: SHOP,
      body: "Need help",
      kind: "message",
      merchantEmail: "me@shop.test",
      merchantName: "Me",
      locale: "fr",
    });
  });

  it.each([
    ["posted field beats the query param", undefined, "ja", "?locale=de", "ja"],
    ["query param when nothing is posted", undefined, "", "?locale=de-CH", "de"],
    ["en when there is nothing", undefined, "", "", "en"],
    ["getLocale beats the posted field", (): string => "pl", "ja", "?locale=de", "pl"],
    ["getLocale returning null falls through to posted", (): null => null, "pt", "", "pt-BR"],
    [
      "getLocale throwing falls through to posted",
      (): never => {
        throw new Error("x");
      },
      "zh-Hant",
      "",
      "zh-TW",
    ],
  ] as const)("locale: %s", async (_label, getLocale, posted, query, expected) => {
    const { calls } = mockFetch(() => jsonResponse(201, { conversation: thread.conversation, message: thread.messages[0] }));
    const route = messagesRoute({
      app: "X",
      authenticate: async () => ({ admin: adminWith({}), session: { shop: SHOP } }),
      ...(getLocale ? { getLocale } : {}),
    });
    const res = await route.action({
      request: post({ intent: "send", body: "hi", merchantEmail: "a@b.co", locale: posted }, `https://app.test/app/messages${query}`),
    });
    expect(await body<MessagesActionData>(res)).toEqual({ ok: true, intent: "send" });
    expect(JSON.parse(calls[0]!.init.body as string).locale).toBe(expected);
  });

  it("setup: empty note allowed, email + name filled from shopContact", async () => {
    const { calls } = mockFetch(() => jsonResponse(201, { conversation: { ...thread.conversation, kind: "setup" }, message: thread.messages[0] }));
    const { route, admin } = setup();
    const res = await route.action({ request: post({ intent: "setup", body: "", merchantEmail: "" }) });
    expect(await body<MessagesActionData>(res)).toEqual({ ok: true, intent: "setup" });
    expect(admin.graphql).toHaveBeenCalledTimes(1);
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      kind: "setup",
      body: "",
      merchantEmail: "owner@shop.test",
      merchantName: "Ann Owner",
    });
  });

  it.each([
    [{ intent: "send", body: "", merchantEmail: "a@b.co" }, "error.bodyRequired", 400],
    [{ intent: "send", body: "x".repeat(5001), merchantEmail: "a@b.co" }, "error.bodyTooLong", 400],
    [{ intent: "setup", body: "x".repeat(1001), merchantEmail: "a@b.co" }, "error.noteTooLong", 400],
    [{ intent: "send", body: "hi", merchantEmail: "not-an-email" }, "error.emailInvalid", 400],
    [{ intent: "delete", body: "hi" }, "error.generic", 400],
  ])("validates %j → %s", async (fields, error, status) => {
    const { fn } = mockFetch(() => jsonResponse(201, {}));
    const { route } = setup();
    const res = await route.action({ request: post(fields) });
    expect(res.status).toBe(status);
    expect(await body<MessagesActionData>(res)).toEqual({ ok: false, error });
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns emailRequired when neither the form nor the shop has an email", async () => {
    const { fn } = mockFetch(() => jsonResponse(201, {}));
    const { route } = setup(adminWith({ email: "", contactEmail: null, name: "S" }));
    const res = await route.action({ request: post({ intent: "setup", body: "" }) });
    expect(res.status).toBe(400);
    expect(await body<MessagesActionData>(res)).toEqual({ ok: false, error: "error.emailRequired" });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    [() => jsonResponse(429, { error: "rate_limited" }), "error.rateLimited", 429],
    [() => jsonResponse(400, { error: "invalid_email" }), "error.emailInvalid", 400],
    [() => jsonResponse(400, { error: "invalid_body" }), "error.bodyRequired", 400],
    [() => jsonResponse(401, { error: "unauthorized" }), "error.unavailable", 503],
    [() => jsonResponse(500, {}), "error.unavailable", 503],
    [
      () => {
        throw new TypeError("fetch failed");
      },
      "error.unavailable",
      503,
    ],
  ])("maps service failure #%# to %s", async (respond, error, status) => {
    mockFetch(respond);
    const { route } = setup();
    const res = await route.action({ request: post({ intent: "send", body: "hi", merchantEmail: "a@b.co" }) });
    expect(res.status).toBe(status);
    expect(await body<MessagesActionData>(res)).toEqual({ ok: false, error });
  });

  it("returns 503 without calling out when disabled", async () => {
    vi.stubEnv("NERDLABS_MESSAGES_KEY", "");
    const { fn } = mockFetch(() => jsonResponse(201, {}));
    const { route } = setup();
    const res = await route.action({ request: post({ intent: "send", body: "hi", merchantEmail: "a@b.co" }) });
    expect(res.status).toBe(503);
    expect(fn).not.toHaveBeenCalled();
  });

  it("turns an unexpected throw into a JSON 503, not a 500 page", async () => {
    const route = messagesRoute({
      app: "X",
      authenticate: async () => ({ admin: adminWith({}), session: { shop: SHOP } }),
      client: () => {
        throw new Error("bug");
      },
    });
    const res = await route.action({ request: post({ intent: "send", body: "hi", merchantEmail: "a@b.co" }) });
    expect(res.status).toBe(503);
    expect(await body<MessagesActionData>(res)).toEqual({ ok: false, error: "error.unavailable" });
    const loaded = await route.loader({ request: new Request("https://app.test/app/messages") });
    expect(await body<MessagesLoaderData>(loaded)).toEqual({ enabled: true, unavailable: true, locale: "en" });
  });

  it("falls back to en when getLocale throws instead of failing the send", async () => {
    mockFetch(() => jsonResponse(201, { conversation: thread.conversation, message: thread.messages[0] }));
    const route = messagesRoute({
      app: "X",
      authenticate: async () => ({ admin: adminWith({}), session: { shop: SHOP } }),
      getLocale: () => {
        throw new Error("locale store down");
      },
    });
    const res = await route.action({ request: post({ intent: "send", body: "hi", merchantEmail: "a@b.co" }) });
    expect(await body<MessagesActionData>(res)).toEqual({ ok: true, intent: "send" });
  });
});
