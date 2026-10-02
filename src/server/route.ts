import { json, type TypedResponse } from "@remix-run/node";
import {
  MAX_BODY_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NOTE_LENGTH,
  resolveLocale,
  type MessageKey,
} from "../i18n/index.js";
import type { MessagesActionData, MessagesIntent, MessagesLoaderData, ShopContact } from "../types.js";
import {
  createMessagesClient,
  isMessagesEnabled,
  MessagesRequestError,
  MessagesUnavailableError,
  type MessagesClient,
} from "./client.js";
import { shopContact, type AdminGraphqlClient } from "./contact.js";

export type MessagesSession = { shop: string };

export type MessagesAuthResult = { admin: AdminGraphqlClient; session: MessagesSession };

export type MessagesRouteOptions = {
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

export type MessagesRouteArgs = { request: Request };

export type MessagesRoute = {
  loader: (args: MessagesRouteArgs) => Promise<TypedResponse<MessagesLoaderData>>;
  action: (args: MessagesRouteArgs) => Promise<TypedResponse<MessagesActionData>>;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 200;

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

function defaultLocale(request: Request): string {
  try {
    return new URL(request.url).searchParams.get("locale") ?? "en";
  } catch {
    return "en";
  }
}

async function localeFor(
  options: MessagesRouteOptions,
  request: Request,
  session: MessagesSession,
): Promise<string> {
  try {
    const raw = options.getLocale ? await options.getLocale(request, session) : defaultLocale(request);
    return resolveLocale(raw);
  } catch (error) {
    console.error("[nerdlabs-messages] getLocale failed, using en:", error);
    return "en";
  }
}

function field(form: FormData | null, name: string): string {
  const value = form?.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function fail(error: MessageKey, status: number): TypedResponse<MessagesActionData> {
  return json<MessagesActionData>({ ok: false, error }, { status });
}

/** Map a service 4xx code to an i18n key + HTTP status for the app's response. */
function requestErrorResponse(error: MessagesRequestError): TypedResponse<MessagesActionData> {
  switch (error.code) {
    case "rate_limited":
      return fail("error.rateLimited", 429);
    case "invalid_email":
      return fail("error.emailInvalid", 400);
    case "invalid_body":
      return fail("error.bodyRequired", 400);
    default:
      // 401 (bad/rotated key), invalid_shop, or an unknown validation code: a
      // deployment problem the merchant can't fix — point them at email.
      console.error("[nerdlabs-messages] service rejected request:", error.status, error.code);
      return fail("error.unavailable", 503);
  }
}

/**
 * Build `{ loader, action }` for the app's `/app/messages` route.
 *
 * Neither function ever lets a kit/service failure escape as a 500 page; only
 * responses thrown by the app's own `authenticate` propagate (that's Shopify's
 * auth flow working as intended).
 */
export function messagesRoute(options: MessagesRouteOptions): MessagesRoute {
  const getClient = options.client ?? (() => createMessagesClient());

  async function loader({ request }: MessagesRouteArgs): Promise<TypedResponse<MessagesLoaderData>> {
    const { admin, session } = await options.authenticate(request);
    if (!isMessagesEnabled()) return json<MessagesLoaderData>({ enabled: false });
    const locale = await localeFor(options, request, session);

    try {
      const client = getClient();
      const [thread, contact] = await Promise.all([client.getThread(session.shop), shopContact(admin)]);

      if (thread.unread > 0) {
        // Fire-and-forget: opening the page reads the thread. Never blocks or fails the loader.
        client.markRead(session.shop).catch((error: unknown) => {
          console.error("[nerdlabs-messages] markRead failed:", error);
        });
      }

      return json<MessagesLoaderData>({
        enabled: true,
        conversation: thread.conversation,
        messages: thread.messages,
        unread: thread.unread,
        contact,
        locale,
        app: options.app,
      });
    } catch (error) {
      if (!(error instanceof MessagesUnavailableError)) {
        // 4xx (e.g. 401 bad key) or a programming error: still fail open, but loudly.
        console.error("[nerdlabs-messages] loader failed:", error);
      }
      return json<MessagesLoaderData>({ enabled: true, unavailable: true, locale });
    }
  }

  async function action({ request }: MessagesRouteArgs): Promise<TypedResponse<MessagesActionData>> {
    const { admin, session } = await options.authenticate(request);

    try {
      if (!isMessagesEnabled()) return fail("error.unavailable", 503);
      if (request.method.toUpperCase() !== "POST") return fail("error.generic", 405);

      let form: FormData | null = null;
      try {
        form = await request.formData();
      } catch {
        return fail("error.generic", 400);
      }

      const intentRaw = field(form, "intent");
      if (intentRaw !== "send" && intentRaw !== "setup") return fail("error.generic", 400);
      const intent: MessagesIntent = intentRaw;

      const body = field(form, "body");
      if (intent === "send") {
        if (body.length === 0) return fail("error.bodyRequired", 400);
        if (body.length > MAX_BODY_LENGTH) return fail("error.bodyTooLong", 400);
      } else if (body.length > MAX_NOTE_LENGTH) {
        return fail("error.noteTooLong", 400);
      }

      let merchantEmail = field(form, "merchantEmail");
      let merchantName = field(form, "merchantName");
      if (!merchantEmail || !merchantName) {
        const contact: ShopContact = await shopContact(admin);
        merchantEmail ||= contact.email;
        merchantName ||= contact.name;
      }
      if (!merchantEmail) return fail("error.emailRequired", 400);
      if (!isValidEmail(merchantEmail)) return fail("error.emailInvalid", 400);

      const locale = await localeFor(options, request, session);
      await getClient().postMessage({
        shop: session.shop,
        body,
        kind: intent === "setup" ? "setup" : "message",
        merchantEmail,
        merchantName: merchantName.slice(0, MAX_NAME_LENGTH) || undefined,
        locale,
      });
      return json<MessagesActionData>({ ok: true, intent });
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
