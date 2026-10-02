import { createMessagesClient, isMessagesEnabled, MessagesUnavailableError, type MessagesClient } from "./client.js";

/**
 * Helpers that run on (nearly) every page load — the layout's nav badge and the
 * dashboard's setup card. They must never noticeably slow a page down, so they
 * use a short timeout and a process-local circuit breaker: once the service is
 * unavailable, calls are skipped for `CIRCUIT_OPEN_MS` and return `null`.
 */
export const LAYOUT_TIMEOUT_MS = 1000;
export const CIRCUIT_OPEN_MS = 60_000;

let circuitOpenUntil = 0;
let lastLogAt = Number.NEGATIVE_INFINITY;

/** Test/ops hook: close the breaker and reset log throttling. */
export function resetMessagesCircuitBreaker(): void {
  circuitOpenUntil = 0;
  lastLogAt = Number.NEGATIVE_INFINITY;
}

function logThrottled(message: string, error: unknown): void {
  const now = Date.now();
  if (now - lastLogAt < CIRCUIT_OPEN_MS) return;
  lastLogAt = now;
  console.error(message, error);
}

async function guarded<T>(label: string, call: (client: MessagesClient) => Promise<T>): Promise<T | null> {
  if (!isMessagesEnabled()) return null;
  if (Date.now() < circuitOpenUntil) return null;
  try {
    return await call(createMessagesClient({ timeoutMs: LAYOUT_TIMEOUT_MS }));
  } catch (error) {
    if (error instanceof MessagesUnavailableError) {
      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      logThrottled(`[nerdlabs-messages] ${label} unavailable; skipping calls for ${CIRCUIT_OPEN_MS / 1000}s:`, error);
    } else {
      // 4xx (e.g. a rotated key) or a programming error: don't trip the breaker, but don't spam either.
      logThrottled(`[nerdlabs-messages] ${label} failed:`, error);
    }
    return null;
  }
}

/**
 * Unread admin/system message count for the nav badge. `null` when the kit is
 * disabled, the breaker is open, or on any error — never throws, ≤ ~1s.
 */
export async function unreadCountForShop(shop: string): Promise<number | null> {
  return guarded("unread count", (client) => client.getUnread(shop));
}

export type ThreadSummary = {
  unread: number;
  /** A free-setup request exists and isn't closed yet. */
  setupOpen: boolean;
};

/**
 * Cheap thread summary for the dashboard (e.g. `FreeSetupCard alreadyRequested`).
 * Same fail-open contract as `unreadCountForShop`: `null` when disabled/unavailable.
 */
export async function threadSummaryForShop(shop: string): Promise<ThreadSummary | null> {
  return guarded("thread summary", async (client) => {
    const thread = await client.getThread(shop);
    const conversation = thread.conversation;
    return {
      unread: thread.unread,
      setupOpen: conversation?.kind === "setup" && conversation.status !== "closed",
    };
  });
}
