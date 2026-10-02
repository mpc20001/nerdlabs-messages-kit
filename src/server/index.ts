import { createMessagesClient, isMessagesEnabled } from "./client.js";

export {
  createMessagesClient,
  isMessagesEnabled,
  messagesBaseUrl,
  MessagesRequestError,
  MessagesUnavailableError,
  DEFAULT_MESSAGES_URL,
  REQUEST_TIMEOUT_MS,
  POST_TIMEOUT_MS,
} from "./client.js";
export {
  unreadCountForShop,
  threadSummaryForShop,
  resetMessagesCircuitBreaker,
  LAYOUT_TIMEOUT_MS,
  CIRCUIT_OPEN_MS,
} from "./layout.js";
export type { ThreadSummary } from "./layout.js";
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
 * GDPR `shop/redact`: delete this shop's conversation. A no-op (resolves) only
 * when the kit is disabled. When enabled, any failure is logged and RE-THROWN:
 * the webhook must answer non-200 so Shopify redelivers — swallowing it would
 * silently lose a mandatory erasure. The service's delete is idempotent, so
 * redelivery is safe.
 */
export async function redactShop(shop: string): Promise<void> {
  if (!isMessagesEnabled()) return;
  try {
    await createMessagesClient().deleteThread(shop);
  } catch (error) {
    console.error(`[nerdlabs-messages] redactShop failed for ${shop}:`, error);
    throw error;
  }
}
