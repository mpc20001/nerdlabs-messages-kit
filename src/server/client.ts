import type {
  Author,
  Conversation,
  ConversationKind,
  ConversationStatus,
  Message,
  PostMessageInput,
  PostMessageResult,
  Thread,
} from "../types.js";

export const DEFAULT_MESSAGES_URL = "http://127.0.0.1:3027";
export const REQUEST_TIMEOUT_MS = 3000;
/**
 * POST /messages gets a longer budget: a timeout there looks like a failure to
 * the merchant even if the service stored the message, inviting a duplicate re-send.
 */
export const POST_TIMEOUT_MS = 8000;
const API_PREFIX = "/admin/api/v1";

/** The service could not be reached, timed out, returned 5xx, or returned garbage. Fail open. */
export class MessagesUnavailableError extends Error {
  override readonly name = "MessagesUnavailableError";
  readonly status: number | null;
  constructor(message: string, options?: { status?: number | null; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.status = options?.status ?? null;
  }
}

/** The service answered 4xx. `code` is the service's `error` string (e.g. "rate_limited"). */
export class MessagesRequestError extends Error {
  override readonly name = "MessagesRequestError";
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`Nerd Labs Messages request failed: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

export type MessagesClientOptions = {
  /** Defaults to `process.env.NERDLABS_MESSAGES_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.NERDLABS_MESSAGES_URL` or http://127.0.0.1:3027. */
  baseUrl?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (response headers AND body) for reads/read-marks/deletes; defaults to 3000. */
  timeoutMs?: number;
  /** Timeout in ms (response headers AND body) for `postMessage`; defaults to 8000. */
  postTimeoutMs?: number;
};

export type MessagesClient = {
  getThread(shop: string): Promise<Thread>;
  getUnread(shop: string): Promise<number>;
  postMessage(input: PostMessageInput): Promise<PostMessageResult>;
  markRead(shop: string): Promise<void>;
  deleteThread(shop: string): Promise<number>;
};

function env(name: string): string | undefined {
  // Read at call time (not module load) so dotenv/PM2 env changes are honoured.
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value && value.trim() ? value.trim() : undefined;
}

/** True only when `NERDLABS_MESSAGES_KEY` is set. When false the kit makes no calls and renders nothing. */
export function isMessagesEnabled(): boolean {
  return env("NERDLABS_MESSAGES_KEY") !== undefined;
}

export function messagesBaseUrl(): string {
  return env("NERDLABS_MESSAGES_URL") ?? DEFAULT_MESSAGES_URL;
}

// ---------------------------------------------------------------------------
// Response shape guards. The service is ours, but a proxy error page or a
// half-deployed service must surface as "unavailable", not as a render crash.
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const AUTHORS: readonly Author[] = ["merchant", "admin", "system"];
const KINDS: readonly ConversationKind[] = ["message", "setup"];
const STATUSES: readonly ConversationStatus[] = ["open", "waiting_on_merchant", "setup_in_progress", "closed"];

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function toMessage(value: unknown): Message | null {
  if (!isObject(value)) return null;
  const { id, author, body, createdAt } = value;
  if (typeof id !== "string" || !includes(AUTHORS, author) || typeof body !== "string" || typeof createdAt !== "string") {
    return null;
  }
  return { id, author, body, createdAt };
}

function toConversation(value: unknown): Conversation | null {
  if (!isObject(value)) return null;
  const { id, kind, status } = value;
  if (typeof id !== "string" || !includes(KINDS, kind) || !includes(STATUSES, status)) return null;
  return { id, kind, status };
}

function toCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function malformed(path: string): MessagesUnavailableError {
  return new MessagesUnavailableError(`Nerd Labs Messages returned an unexpected response for ${path}`);
}

/**
 * Race `work` against a timer — deliberately WITHOUT AbortSignal.
 *
 * Consuming apps run under remix-serve, which installs Remix's web-fetch
 * polyfill. Its abort path cancels an already-locked request BODY stream
 * without awaiting it: the fetch rejects with AbortError (handled), but the
 * cancel rejects with a TypeError nobody owns → unhandled rejection → Node
 * exits → PM2 restart, dropping every in-flight request. Racing a timer leaves
 * the losing request to finish on its own; Promise.race attaches a handler to
 * the loser, so its later settlement can never surface as an unhandled
 * rejection. (Same pattern as nerdlabs-shopify-starter `withDeadline`.)
 */
async function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createMessagesClient(options: MessagesClientOptions = {}): MessagesClient {
  const apiKey = options.apiKey ?? env("NERDLABS_MESSAGES_KEY");
  if (!apiKey) {
    throw new TypeError("createMessagesClient: no apiKey given and NERDLABS_MESSAGES_KEY is not set");
  }
  const baseUrl = (options.baseUrl ?? messagesBaseUrl()).replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const postTimeoutMs = options.postTimeoutMs ?? POST_TIMEOUT_MS;

  /**
   * fetch + read the full body. Never rejects with anything but
   * MessagesUnavailableError. When the deadline wins, this keeps running
   * unobserved and still drains the body, so the socket is released whenever
   * the service eventually answers.
   */
  async function roundTrip(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string | undefined },
    method: string,
    path: string,
  ): Promise<{ response: Response; text: string; readFailed: boolean; readError?: unknown }> {
    let response: Response;
    try {
      response = await doFetch(url, {
        ...init,
        // Never follow a redirect with the bearer key attached.
        redirect: "error",
      });
    } catch (error) {
      // Network failure, DNS, connection refused, redirect.
      throw new MessagesUnavailableError(`Nerd Labs Messages unreachable (${method} ${path})`, { cause: error });
    }
    try {
      return { response, text: await response.text(), readFailed: false };
    } catch (readError) {
      return { response, text: "", readFailed: true, readError };
    }
  }

  async function request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: JsonObject,
    timeout: number = timeoutMs,
  ): Promise<unknown> {
    const url = `${baseUrl}${API_PREFIX}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    // The whole round-trip — headers AND body — is bounded by a raced timer,
    // deliberately WITHOUT an AbortSignal (see `withDeadline`).
    const { response, text, readFailed, readError } = await withDeadline(
      roundTrip(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, method, path),
      timeout,
      () => new MessagesUnavailableError(`Nerd Labs Messages timed out after ${timeout}ms (${method} ${path})`),
    );

    let payload: unknown = null;
    let parsed = false;
    try {
      if (readFailed) throw readError;
      if (text) {
        payload = JSON.parse(text);
        parsed = true;
      }
    } catch (error) {
      if (response.status >= 500 || response.ok) {
        throw new MessagesUnavailableError(`Nerd Labs Messages returned an unreadable body (${method} ${path})`, {
          status: response.status,
          cause: error,
        });
      }
      // A 4xx with a non-JSON body still is a 4xx; fall through with no code.
    }

    if (response.status >= 500) {
      throw new MessagesUnavailableError(`Nerd Labs Messages returned ${response.status} (${method} ${path})`, {
        status: response.status,
      });
    }
    if (response.status >= 400) {
      const code = parsed && isObject(payload) && typeof payload.error === "string" ? payload.error : `http_${response.status}`;
      throw new MessagesRequestError(response.status, code);
    }
    if (!response.ok) {
      // 1xx/3xx can't normally reach here (redirect: "error"), but never treat them as success.
      throw new MessagesUnavailableError(`Nerd Labs Messages returned ${response.status} (${method} ${path})`, {
        status: response.status,
      });
    }
    return payload;
  }

  const shopQuery = (shop: string) => `?shop=${encodeURIComponent(shop)}`;

  return {
    async getThread(shop) {
      const path = "/thread";
      const data = await request("GET", `${path}${shopQuery(shop)}`);
      if (!isObject(data) || !Array.isArray(data.messages)) throw malformed(path);
      const conversation = data.conversation === null ? null : toConversation(data.conversation);
      if (data.conversation !== null && conversation === null) throw malformed(path);
      const messages: Message[] = [];
      for (const raw of data.messages) {
        const message = toMessage(raw);
        if (message) messages.push(message);
      }
      // A required count that's missing/invalid means the response isn't the
      // contract: treating it as 0 would hide unread replies and skip markRead.
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
      const body: JsonObject = {
        shop: input.shop,
        body: input.body,
        kind: input.kind ?? "message",
        merchantEmail: input.merchantEmail,
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
      // GDPR erasure must be verifiable: an off-contract body is an error, not "0".
      const deleted = isObject(data) ? toCount(data.deleted) : null;
      if (deleted === null) throw malformed(path);
      return deleted;
    },
  };
}
