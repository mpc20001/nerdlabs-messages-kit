import type { MessageKey } from "./i18n/en.js";

/**
 * Wire types from nerdlabs-messages/API.md (App API v1). Shared by the server
 * client and the UI so loader data and components agree on one shape.
 */
export type Author = "merchant" | "admin" | "system";

export type Message = {
  id: string;
  author: Author;
  body: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
};

export type ConversationKind = "message" | "setup";
export type ConversationStatus = "open" | "waiting_on_merchant" | "setup_in_progress" | "closed";

export type Conversation = {
  id: string;
  kind: ConversationKind;
  status: ConversationStatus;
};

export type Thread = {
  conversation: Conversation | null;
  messages: Message[];
  unread: number;
};

export type PostMessageInput = {
  shop: string;
  body: string;
  kind?: ConversationKind;
  merchantEmail: string;
  merchantName?: string;
  locale?: string;
};

export type PostMessageResult = {
  conversation: Conversation;
  message: Message;
};

export type ShopContact = { email: string; name: string };

/** Data returned by `messagesRoute().loader` and consumed by `<MessagesPage />`. */
export type MessagesLoaderData =
  | { enabled: false }
  | { enabled: true; unavailable: true; locale: string }
  | {
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

export type MessagesIntent = "send" | "setup";

/** Data returned by `messagesRoute().action` (consumed via `useFetcher`). */
export type MessagesActionData =
  | { ok: true; intent: MessagesIntent }
  | { ok: false; error: MessageKey };
