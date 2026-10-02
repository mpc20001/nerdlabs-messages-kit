import { MAX_EMAIL_LENGTH, resolveLocale, MAX_BODY_LENGTH, MAX_NOTE_LENGTH } from './shared-chunk.js';
export { SUPPORTED_LOCALES, messagesNavLabel, resolveLocale, t } from './shared-chunk.js';
import { json } from '@remix-run/node';

// src/server/client.ts
var DEFAULT_MESSAGES_URL = "http://127.0.0.1:3027";
var REQUEST_TIMEOUT_MS = 3e3;
var POST_TIMEOUT_MS = 8e3;
var API_PREFIX = "/admin/api/v1";
var MessagesUnavailableError = class extends Error {
  name = "MessagesUnavailableError";
  status;
  constructor(message, options) {
    super(message, options?.cause === void 0 ? void 0 : { cause: options.cause });
    this.status = options?.status ?? null;
  }
};
var MessagesRequestError = class extends Error {
  name = "MessagesRequestError";
  status;
  code;
  constructor(status, code) {
    super(`Nerd Labs Messages request failed: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
};
function env(name) {
  const value = typeof process !== "undefined" ? process.env[name] : void 0;
  return value && value.trim() ? value.trim() : void 0;
}
function isMessagesEnabled() {
  return env("NERDLABS_MESSAGES_KEY") !== void 0;
}
function messagesBaseUrl() {
  return env("NERDLABS_MESSAGES_URL") ?? DEFAULT_MESSAGES_URL;
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var AUTHORS = ["merchant", "admin", "system"];
var KINDS = ["message", "setup"];
var STATUSES = ["open", "waiting_on_merchant", "setup_in_progress", "closed"];
function includes(list, value) {
  return typeof value === "string" && list.includes(value);
}
function toMessage(value) {
  if (!isObject(value)) return null;
  const { id, author, body, createdAt } = value;
  if (typeof id !== "string" || !includes(AUTHORS, author) || typeof body !== "string" || typeof createdAt !== "string") {
    return null;
  }
  return { id, author, body, createdAt };
}
function toConversation(value) {
  if (!isObject(value)) return null;
  const { id, kind, status } = value;
  if (typeof id !== "string" || !includes(KINDS, kind) || !includes(STATUSES, status)) return null;
  return { id, kind, status };
}
function toCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
function malformed(path) {
  return new MessagesUnavailableError(`Nerd Labs Messages returned an unexpected response for ${path}`);
}
function createMessagesClient(options = {}) {
  const apiKey = options.apiKey ?? env("NERDLABS_MESSAGES_KEY");
  if (!apiKey) {
    throw new TypeError("createMessagesClient: no apiKey given and NERDLABS_MESSAGES_KEY is not set");
  }
  const baseUrl = (options.baseUrl ?? messagesBaseUrl()).replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const postTimeoutMs = options.postTimeoutMs ?? POST_TIMEOUT_MS;
  async function request(method, path, body, timeout = timeoutMs) {
    const url = `${baseUrl}${API_PREFIX}${path}`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    };
    if (body !== void 0) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
        // Never follow a redirect with the bearer key attached.
        redirect: "error"
      });
    } catch (error) {
      throw new MessagesUnavailableError(`Nerd Labs Messages unreachable (${method} ${path})`, { cause: error });
    }
    let payload = null;
    let parsed = false;
    try {
      const text = await response.text();
      if (text) {
        payload = JSON.parse(text);
        parsed = true;
      }
    } catch (error) {
      if (response.status >= 500 || response.ok) {
        throw new MessagesUnavailableError(`Nerd Labs Messages returned an unreadable body (${method} ${path})`, {
          status: response.status,
          cause: error
        });
      }
    }
    if (response.status >= 500) {
      throw new MessagesUnavailableError(`Nerd Labs Messages returned ${response.status} (${method} ${path})`, {
        status: response.status
      });
    }
    if (response.status >= 400) {
      const code = parsed && isObject(payload) && typeof payload.error === "string" ? payload.error : `http_${response.status}`;
      throw new MessagesRequestError(response.status, code);
    }
    if (!response.ok) {
      throw new MessagesUnavailableError(`Nerd Labs Messages returned ${response.status} (${method} ${path})`, {
        status: response.status
      });
    }
    return payload;
  }
  const shopQuery = (shop) => `?shop=${encodeURIComponent(shop)}`;
  return {
    async getThread(shop) {
      const path = "/thread";
      const data = await request("GET", `${path}${shopQuery(shop)}`);
      if (!isObject(data) || !Array.isArray(data.messages)) throw malformed(path);
      const conversation = data.conversation === null ? null : toConversation(data.conversation);
      if (data.conversation !== null && conversation === null) throw malformed(path);
      const messages = [];
      for (const raw of data.messages) {
        const message = toMessage(raw);
        if (message) messages.push(message);
      }
      const unread = toCount(data.unread);
      if (unread === null) throw malformed(path);
      return { conversation, messages, unread };
    },
    async getUnread(shop) {
      const path = "/unread";
      const data = await request("GET", `${path}${shopQuery(shop)}`);
      const unread = isObject(data) ? toCount(data.unread) : null;
      if (unread === null) throw malformed(path);
      return unread;
    },
    async postMessage(input) {
      const path = "/messages";
      const body = {
        shop: input.shop,
        body: input.body,
        kind: input.kind ?? "message",
        merchantEmail: input.merchantEmail
      };
      if (input.merchantName) body.merchantName = input.merchantName;
      if (input.locale) body.locale = input.locale;
      const data = await request("POST", path, body, postTimeoutMs);
      const conversation = isObject(data) ? toConversation(data.conversation) : null;
      const message = isObject(data) ? toMessage(data.message) : null;
      if (!conversation || !message) throw malformed(path);
      return { conversation, message };
    },
    async markRead(shop) {
      await request("POST", "/read", { shop });
    },
    async deleteThread(shop) {
      const path = "/thread";
      const data = await request("DELETE", `${path}${shopQuery(shop)}`);
      const deleted = isObject(data) ? toCount(data.deleted) : null;
      if (deleted === null) throw malformed(path);
      return deleted;
    }
  };
}

// src/server/layout.ts
var LAYOUT_TIMEOUT_MS = 1e3;
var CIRCUIT_OPEN_MS = 6e4;
var circuitOpenUntil = 0;
var lastLogAt = Number.NEGATIVE_INFINITY;
function resetMessagesCircuitBreaker() {
  circuitOpenUntil = 0;
  lastLogAt = Number.NEGATIVE_INFINITY;
}
function logThrottled(message, error) {
  const now = Date.now();
  if (now - lastLogAt < CIRCUIT_OPEN_MS) return;
  lastLogAt = now;
  console.error(message, error);
}
async function guarded(label, call) {
  if (!isMessagesEnabled()) return null;
  if (Date.now() < circuitOpenUntil) return null;
  try {
    return await call(createMessagesClient({ timeoutMs: LAYOUT_TIMEOUT_MS }));
  } catch (error) {
    if (error instanceof MessagesUnavailableError) {
      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      logThrottled(`[nerdlabs-messages] ${label} unavailable; skipping calls for ${CIRCUIT_OPEN_MS / 1e3}s:`, error);
    } else {
      logThrottled(`[nerdlabs-messages] ${label} failed:`, error);
    }
    return null;
  }
}
async function unreadCountForShop(shop) {
  return guarded("unread count", (client) => client.getUnread(shop));
}
async function threadSummaryForShop(shop) {
  return guarded("thread summary", async (client) => {
    const thread = await client.getThread(shop);
    const conversation = thread.conversation;
    return {
      unread: thread.unread,
      setupOpen: conversation?.kind === "setup" && conversation.status !== "closed"
    };
  });
}

// src/server/contact.ts
var SHOP_CONTACT_QUERY = `#graphql
  query NerdLabsMessagesShopContact {
    shop {
      email
      name
      shopOwnerName
      contactEmail
    }
  }
`;
function str(value) {
  return typeof value === "string" ? value.trim() : "";
}
async function shopContact(admin) {
  try {
    if (!admin) return { email: "", name: "" };
    const response = await admin.graphql(SHOP_CONTACT_QUERY);
    const payload = await response.json();
    const shop = typeof payload === "object" && payload !== null ? payload.data?.shop : void 0;
    if (!shop || typeof shop !== "object") return { email: "", name: "" };
    return {
      email: str(shop.contactEmail) || str(shop.email),
      name: str(shop.shopOwnerName) || str(shop.name)
    };
  } catch (error) {
    console.error("[nerdlabs-messages] shopContact failed:", error);
    return { email: "", name: "" };
  }
}
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var MAX_NAME_LENGTH = 200;
function isValidEmail(value) {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}
function queryLocale(request) {
  try {
    return new URL(request.url).searchParams.get("locale");
  } catch {
    return null;
  }
}
async function explicitLocaleFor(options, request, session, postedLocale) {
  if (options.getLocale) {
    try {
      const fromApp = await options.getLocale(request, session);
      if (typeof fromApp === "string" && fromApp.trim()) return resolveLocale(fromApp);
    } catch (error) {
      console.error("[nerdlabs-messages] getLocale failed, falling back:", error);
    }
  }
  if (postedLocale) return resolveLocale(postedLocale);
  const fromQuery = queryLocale(request);
  return fromQuery ? resolveLocale(fromQuery) : void 0;
}
function field(form, name) {
  const value = form?.get(name);
  return typeof value === "string" ? value.trim() : "";
}
function fail(error, status) {
  return json({ ok: false, error }, { status });
}
function requestErrorResponse(error) {
  switch (error.code) {
    case "rate_limited":
      return fail("error.rateLimited", 429);
    case "invalid_email":
      return fail("error.emailInvalid", 400);
    case "invalid_body":
      return fail("error.bodyRequired", 400);
    default:
      console.error("[nerdlabs-messages] service rejected request:", error.status, error.code);
      return fail("error.unavailable", 503);
  }
}
function messagesRoute(options) {
  const getClient = options.client ?? (() => createMessagesClient());
  async function loader({ request }) {
    const { admin, session } = await options.authenticate(request);
    if (!isMessagesEnabled()) return json({ enabled: false });
    const explicit = await explicitLocaleFor(options, request, session);
    const locale = explicit ?? resolveLocale(null);
    try {
      const client = getClient();
      const [thread, contact] = await Promise.all([client.getThread(session.shop), shopContact(admin)]);
      if (thread.unread > 0) {
        client.markRead(session.shop).catch((error) => {
          console.error("[nerdlabs-messages] markRead failed:", error);
        });
      }
      return json({
        enabled: true,
        conversation: thread.conversation,
        messages: thread.messages,
        unread: thread.unread,
        contact,
        locale,
        localeExplicit: explicit !== void 0,
        app: options.app
      });
    } catch (error) {
      if (!(error instanceof MessagesUnavailableError)) {
        console.error("[nerdlabs-messages] loader failed:", error);
      }
      return json({ enabled: true, unavailable: true, locale });
    }
  }
  async function action({ request }) {
    const { admin, session } = await options.authenticate(request);
    try {
      if (!isMessagesEnabled()) return fail("error.unavailable", 503);
      if (request.method.toUpperCase() !== "POST") return fail("error.generic", 405);
      let form = null;
      try {
        form = await request.formData();
      } catch {
        return fail("error.generic", 400);
      }
      const intentRaw = field(form, "intent");
      if (intentRaw !== "send" && intentRaw !== "setup") return fail("error.generic", 400);
      const intent = intentRaw;
      const body = field(form, "body");
      if (intent === "send") {
        if (body.length === 0) return fail("error.bodyRequired", 400);
        if (body.length > MAX_BODY_LENGTH) return fail("error.bodyTooLong", 400);
      } else if (body.length > MAX_NOTE_LENGTH) {
        return fail("error.noteTooLong", 400);
      }
      let merchantEmail = field(form, "merchantEmail");
      let merchantName = field(form, "merchantName");
      if (!merchantEmail) {
        const contact = await shopContact(admin);
        merchantEmail = contact.email;
        merchantName ||= contact.name;
      }
      if (!merchantEmail) return fail("error.emailRequired", 400);
      if (!isValidEmail(merchantEmail)) return fail("error.emailInvalid", 400);
      const locale = await explicitLocaleFor(options, request, session, field(form, "locale"));
      await getClient().postMessage({
        shop: session.shop,
        body,
        kind: intent === "setup" ? "setup" : "message",
        merchantEmail,
        merchantName: merchantName.slice(0, MAX_NAME_LENGTH) || void 0,
        locale
      });
      return json({ ok: true, intent });
    } catch (error) {
      if (error instanceof MessagesRequestError) return requestErrorResponse(error);
      if (!(error instanceof MessagesUnavailableError)) {
        console.error("[nerdlabs-messages] action failed:", error);
      }
      return fail("error.unavailable", 503);
    }
  }
  return { loader, action };
}

// src/server/index.ts
async function redactShop(shop) {
  if (!isMessagesEnabled()) return;
  try {
    await createMessagesClient().deleteThread(shop);
  } catch (error) {
    console.error(`[nerdlabs-messages] redactShop failed for ${shop}:`, error);
    throw error;
  }
}

export { CIRCUIT_OPEN_MS, DEFAULT_MESSAGES_URL, LAYOUT_TIMEOUT_MS, MessagesRequestError, MessagesUnavailableError, POST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SHOP_CONTACT_QUERY, createMessagesClient, isMessagesEnabled, isValidEmail, messagesBaseUrl, messagesRoute, redactShop, resetMessagesCircuitBreaker, shopContact, threadSummaryForShop, unreadCountForShop };
