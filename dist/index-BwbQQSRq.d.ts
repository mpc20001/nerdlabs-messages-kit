/**
 * English source dictionary. Every other locale must provide exactly these keys
 * with exactly the same `{placeholder}` set (enforced by test/i18n.test.ts and,
 * for keys, by the `Dictionary` type).
 *
 * "Nerd Labs" is a brand name and stays untranslated everywhere.
 */
declare const en: {
    "nav.messages": string;
    "nav.messagesWithCount": string;
    "page.title": string;
    "page.subtitle": string;
    "page.empty": string;
    "author.you": string;
    "author.admin": string;
    "author.system": string;
    "composer.label": string;
    "composer.placeholder": string;
    "composer.emailLabel": string;
    "composer.emailHelp": string;
    "composer.send": string;
    "composer.sent": string;
    "setup.requestedBanner": string;
    "setupCard.title": string;
    "setupCard.body": string;
    "setupCard.noteLabel": string;
    "setupCard.button": string;
    "setupCard.success": string;
    "setupCard.viewMessages": string;
    "helpLine.text": string;
    "helpLine.button": string;
    "error.bodyRequired": string;
    "error.bodyTooLong": string;
    "error.noteTooLong": string;
    "error.emailRequired": string;
    "error.emailInvalid": string;
    "error.rateLimited": string;
    "error.unavailable": string;
    "error.generic": string;
};
type MessageKey = keyof typeof en;

/**
 * Wire types from nerdlabs-messages/API.md (App API v1). Shared by the server
 * client and the UI so loader data and components agree on one shape.
 */
type Author = "merchant" | "admin" | "system";
type Message = {
    id: string;
    author: Author;
    body: string;
    /** ISO-8601 timestamp. */
    createdAt: string;
};
type ConversationKind = "message" | "setup";
type ConversationStatus = "open" | "waiting_on_merchant" | "setup_in_progress" | "closed";
type Conversation = {
    id: string;
    kind: ConversationKind;
    status: ConversationStatus;
};
type Thread = {
    conversation: Conversation | null;
    messages: Message[];
    unread: number;
};
type PostMessageInput = {
    shop: string;
    body: string;
    kind?: ConversationKind;
    merchantEmail: string;
    merchantName?: string;
    locale?: string;
};
type PostMessageResult = {
    conversation: Conversation;
    message: Message;
};
type ShopContact = {
    email: string;
    name: string;
};
/** Data returned by `messagesRoute().loader` and consumed by `<MessagesPage />`. */
type MessagesLoaderData = {
    enabled: false;
} | {
    enabled: true;
    unavailable: true;
    locale: string;
} | {
    enabled: true;
    unavailable?: false;
    conversation: Conversation | null;
    messages: Message[];
    unread: number;
    contact: ShopContact;
    locale: string;
    /** True when the locale came from a real source (not the "en" default). */
    localeExplicit?: boolean;
    app: string;
};
type MessagesIntent = "send" | "setup";
/** Data returned by `messagesRoute().action` (consumed via `useFetcher`). */
type MessagesActionData = {
    ok: true;
    intent: MessagesIntent;
} | {
    ok: false;
    error: MessageKey;
};

declare const SUPPORTED_LOCALES: readonly ["en", "cs", "da", "de", "es", "fi", "fr", "it", "ja", "ko", "nb", "nl", "pl", "pt-BR", "pt-PT", "sv", "th", "tr", "vi", "zh-CN", "zh-TW"];
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
/**
 * Resolve any BCP-47-ish tag ("de", "de-AT", "pt_PT", "zh-Hant-HK", "EN-us")
 * to one of the kit's supported locales.
 * Order: exact → known alias → language-prefix → "en".
 */
declare function resolveLocale(input: string | null | undefined): SupportedLocale;
/** Shared constants used by both the server action and the UI. */
declare const SUPPORT_EMAIL = "support@nerdlabs.us";
type TranslationVars = Readonly<Record<string, string | number>>;
declare function isMessageKey(key: unknown): key is MessageKey;
/**
 * Translate `key` for `locale`, substituting `{var}` placeholders.
 * Unknown placeholders are left as-is so a missing var is visible, not silent.
 */
declare function t(locale: string | null | undefined, key: MessageKey, vars?: TranslationVars): string;
/** "Messages" or "Messages (2)" for the app's nav link. */
declare function messagesNavLabel(locale: string | null | undefined, unread?: number | null): string;
/** Localized text for an action error key, with its `{email}` / `{max}` filled in. */
declare function errorMessage(locale: string | null | undefined, key: MessageKey): string;

export { type Author as A, type Conversation as C, type MessagesLoaderData as M, type PostMessageInput as P, type ShopContact as S, type Thread as T, type PostMessageResult as a, type MessagesActionData as b, type ConversationKind as c, type ConversationStatus as d, type Message as e, type MessageKey as f, type MessagesIntent as g, SUPPORTED_LOCALES as h, type SupportedLocale as i, SUPPORT_EMAIL as j, type TranslationVars as k, errorMessage as l, messagesNavLabel as m, isMessageKey as n, resolveLocale as r, t };
