import { T as Thread, P as PostMessageInput, a as PostMessageResult, S as ShopContact, M as MessagesLoaderData, b as MessagesActionData } from './index-vVc1LihO.js';
export { A as Author, C as Conversation, c as ConversationKind, d as ConversationStatus, e as Message, f as MessageKey, g as MessagesIntent, h as SUPPORTED_LOCALES, i as SupportedLocale, m as messagesNavLabel, r as resolveLocale, t } from './index-vVc1LihO.js';
import { TypedResponse } from '@remix-run/node';

declare const DEFAULT_MESSAGES_URL = "http://127.0.0.1:3027";
declare const REQUEST_TIMEOUT_MS = 3000;
/** The service could not be reached, timed out, returned 5xx, or returned garbage. Fail open. */
declare class MessagesUnavailableError extends Error {
    readonly name = "MessagesUnavailableError";
    readonly status: number | null;
    constructor(message: string, options?: {
        status?: number | null;
        cause?: unknown;
    });
}
/** The service answered 4xx. `code` is the service's `error` string (e.g. "rate_limited"). */
declare class MessagesRequestError extends Error {
    readonly name = "MessagesRequestError";
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string);
}
type MessagesClientOptions = {
    /** Defaults to `process.env.NERDLABS_MESSAGES_KEY`. */
    apiKey?: string;
    /** Defaults to `process.env.NERDLABS_MESSAGES_URL` or http://127.0.0.1:3027. */
    baseUrl?: string;
    /** Injected for tests; defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Per-request timeout in ms; defaults to 3000. */
    timeoutMs?: number;
};
type MessagesClient = {
    getThread(shop: string): Promise<Thread>;
    getUnread(shop: string): Promise<number>;
    postMessage(input: PostMessageInput): Promise<PostMessageResult>;
    markRead(shop: string): Promise<void>;
    deleteThread(shop: string): Promise<number>;
};
/** True only when `NERDLABS_MESSAGES_KEY` is set. When false the kit makes no calls and renders nothing. */
declare function isMessagesEnabled(): boolean;
declare function messagesBaseUrl(): string;
declare function createMessagesClient(options?: MessagesClientOptions): MessagesClient;

/**
 * The slice of shopify-app-remix's `admin` context the kit needs. Declared as a
 * method so the library's generic `graphql` signature is assignable to it.
 */
type AdminGraphqlClient = {
    graphql(query: string): Promise<{
        json(): Promise<unknown>;
    }>;
};
declare const SHOP_CONTACT_QUERY = "#graphql\n  query NerdLabsMessagesShopContact {\n    shop {\n      email\n      name\n      shopOwnerName\n      contactEmail\n    }\n  }\n";
/**
 * The merchant's contact email + name from the Admin API.
 * Prefers `contactEmail` (the store's customer-facing/support address the
 * merchant chose) over the account `email`; prefers the owner's personal name
 * over the store name. Never throws — returns empties on any failure.
 */
declare function shopContact(admin: AdminGraphqlClient | null | undefined): Promise<ShopContact>;

type MessagesSession = {
    shop: string;
};
type MessagesAuthResult = {
    admin: AdminGraphqlClient;
    session: MessagesSession;
};
type MessagesRouteOptions = {
    /** App name shown to the merchant ("Questions about {app}?"), e.g. "QuickFiles". */
    app: string;
    /**
     * The app's `authenticate.admin`. Anything it throws (Shopify's auth
     * redirects/bounce responses) propagates untouched.
     */
    authenticate: (request: Request) => Promise<MessagesAuthResult>;
    /**
     * Merchant locale. Defaults to the `locale` query param Shopify Admin adds
     * to embedded-app URLs, else "en".
     */
    getLocale?: (request: Request, session: MessagesSession) => string | null | undefined | Promise<string | null | undefined>;
    /**
     * Override the service client factory (tests / custom wiring). Defaults to
     * `createMessagesClient()`. The `NERDLABS_MESSAGES_KEY` gate still applies.
     */
    client?: () => MessagesClient;
};
type MessagesRouteArgs = {
    request: Request;
};
type MessagesRoute = {
    loader: (args: MessagesRouteArgs) => Promise<TypedResponse<MessagesLoaderData>>;
    action: (args: MessagesRouteArgs) => Promise<TypedResponse<MessagesActionData>>;
};
declare function isValidEmail(value: string): boolean;
/**
 * Build `{ loader, action }` for the app's `/app/messages` route.
 *
 * Neither function ever lets a kit/service failure escape as a 500 page; only
 * responses thrown by the app's own `authenticate` propagate (that's Shopify's
 * auth flow working as intended).
 */
declare function messagesRoute(options: MessagesRouteOptions): MessagesRoute;

/**
 * Unread admin/system message count for the nav badge. `null` when the kit is
 * disabled or on any error — never throws, so it is safe in the app layout loader.
 */
declare function unreadCountForShop(shop: string): Promise<number | null>;
/**
 * GDPR `shop/redact`: delete this shop's conversation. No-op when disabled.
 * Swallows failures (logged) so the webhook still answers 200; the service's
 * delete is idempotent, so Shopify's own redelivery or a manual rerun is safe.
 */
declare function redactShop(shop: string): Promise<void>;

export { type AdminGraphqlClient, DEFAULT_MESSAGES_URL, MessagesActionData, type MessagesAuthResult, type MessagesClient, type MessagesClientOptions, MessagesLoaderData, MessagesRequestError, type MessagesRoute, type MessagesRouteArgs, type MessagesRouteOptions, type MessagesSession, MessagesUnavailableError, PostMessageInput, PostMessageResult, REQUEST_TIMEOUT_MS, SHOP_CONTACT_QUERY, ShopContact, Thread, createMessagesClient, isMessagesEnabled, isValidEmail, messagesBaseUrl, messagesRoute, redactShop, shopContact, unreadCountForShop };
