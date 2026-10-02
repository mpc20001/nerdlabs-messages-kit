import { createMessagesClient, isMessagesEnabled } from "./client.js";

export {
  createMessagesClient,
  isMessagesEnabled,
  messagesBaseUrl,
  MessagesRequestError,
  MessagesUnavailableError,
  DEFAULT_MESSAGES_URL,
  REQUEST_TIMEOUT_MS,
} from "./client.js";
export type { MessagesClient, MessagesClientOptions } from "./client.js";
export { shopContact, SHOP_CONTACT_QUERY } from "./contact.js";
export type { AdminGraphqlClient } from "./contact.js";
export { messagesRoute, isValidEmail } from "./route.js";
export type {
  MessagesAuthResult,
  MessagesRoute,
  MessagesRouteArgs,
  MessagesRouteOptions,
  MessagesSession,
} from "./route.js";
export { t, messagesNavLabel, resolveLocale, SUPPORTED_LOCALES } from "../i18n/index.js";
export type { MessageKey, SupportedLocale } from "../i18n/index.js";
export type * from "../types.js";

/**
 * Unread admin/system message count for the nav badge. `null` when the kit is
 * disabled or on any error — never throws, so it is safe in the app layout loader.
 */
export async function unreadCountForShop(shop: string): Promise<number | null> {
  if (!isMessagesEnabled()) return null;
  try {
    return await createMessagesClient().getUnread(shop);
  } catch (error) {
    console.error("[nerdlabs-messages] unread count failed:", error);
    return null;
  }
}

/**
 * GDPR `shop/redact`: delete this shop's conversation. No-op when disabled.
 * Swallows failures (logged) so the webhook still answers 200; the service's
 * delete is idempotent, so Shopify's own redelivery or a manual rerun is safe.
 */
export async function redactShop(shop: string): Promise<void> {
  if (!isMessagesEnabled()) return;
  try {
    await createMessagesClient().deleteThread(shop);
  } catch (error) {
    console.error(`[nerdlabs-messages] redactShop failed for ${shop}:`, error);
  }
}
