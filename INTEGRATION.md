# Integrating `@nerdlabs/messages-kit` into a Nerd Labs app

Per-app checklist. Every step is a few lines. Target stack: Remix 2.16 + Vite 6 +
Polaris 12 + App Bridge React 4 + `@shopify/shopify-app-remix`.

The kit is **off unless `NERDLABS_MESSAGES_KEY` is set**. Off means it makes no
network calls, the page and cards render `null`, and `unreadCountForShop` returns
`null`. Private/custom deployments (Five Dollar, Threaded Labs, …) leave the key
unset and see nothing.

---

## 1. Install + env

```bash
npm i github:mpc20001/nerdlabs-messages-kit#v1.0.0
```

`dist/` is committed, so installing needs no build step.

**Public App Store deployments only.** Add to `/var/www/<app>/.env`:

```
NERDLABS_MESSAGES_KEY=<this app's key from the Messages admin>
# Optional. Default http://127.0.0.1:3027 (the service on the droplet).
NERDLABS_MESSAGES_URL=http://127.0.0.1:3027
```

Then `pm2 restart <app> --update-env`. Never put the key in a private
deployment's `.env`.

**Vite SSR.** The package is plain ESM with an `exports` map, so it should load as
an external. If the dev server or build complains about it (e.g. CJS/ESM interop
with Polaris), add this to `vite.config`:

```js
export default defineConfig({
  // …
  ssr: { noExternal: ["@nerdlabs/messages-kit"] },
});
```

## 2. The messages route

`app/routes/app.messages.jsx`:

```jsx
import { messagesRoute } from "@nerdlabs/messages-kit/server";
import { MessagesPage } from "@nerdlabs/messages-kit/ui";
import { authenticate } from "../shopify.server";
import { getShopLocale } from "../lib/locale.server"; // the app's own stashed-locale lookup

const messages = () =>
  messagesRoute({ app: "QuickFiles", authenticate: authenticate.admin, getLocale: (request, session) => getShopLocale(request, session.shop) });

export const loader = (args) => messages().loader(args);
export const action = (args) => messages().action(args);
export default MessagesPage;
```

- Build the route inside a function (`messages()`), as shown above. Remix's client
  build removes `loader` and `action` and then drops `messages` because nothing
  uses it any more. That keeps `shopify.server` and the kit's server entry out of
  the browser bundle. A top-level `const route = messagesRoute(...)` relies on
  dead-code elimination of a call expression, so don't use it.
- **Pass `getLocale` (strongly recommended).** Return the merchant's stored admin
  locale, the same one the `routes/app` loader uses. App Bridge nav links drop
  Shopify's `?locale=` param, so without `getLocale`:
  - the page renders in the locale from the query param, or `"en"`;
  - the action uses the locale the kit's UI posts, then the query param, then
    `"en"`, to localize the service's system message and emails.

  If `getLocale` throws or returns nothing, the kit falls through to those same
  sources.
- The App Bridge title bar is optional. Wrap the page to add one:
  `export default function Messages() { return <><TitleBar title="Messages" /><MessagesPage /></>; }`.

**Replace the old contact form.** Turn `app/routes/app.contact.jsx` into a
redirect, so old links and bookmarks still work:

```jsx
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  // Keep shop/host/embedded params, or the embedded document load re-auths.
  return redirect(`/app/messages${new URL(request.url).search}`);
};
```

If the kit is disabled for a deployment (private customers), keep the old contact
form for that case instead:
`if (!isMessagesEnabled()) return json({ shop: session.shop });`.

## 3. Nav link, unread badge, plan-gate exemption

In the `app/routes/app.jsx` layout loader:

```js
import { isMessagesEnabled, unreadCountForShop } from "@nerdlabs/messages-kit/server";

// inside loader, after authenticate.admin. Never throws, returns null when off or down:
const unread = await unreadCountForShop(session.shop);
return { /* … */ messagesEnabled: isMessagesEnabled(), unread };
```

In the component:

```jsx
import { messagesNavLabel } from "@nerdlabs/messages-kit/ui";

<NavMenu>
  {/* … */}
  {messagesEnabled && <Link to="/app/messages">{messagesNavLabel(locale, unread)}</Link>}
</NavMenu>
```

`unreadCountForShop` is built for every page load:
- It's one call with a **1-second timeout**.
- It returns `null` when the kit is disabled or on any error, and never throws.
- It sits behind an in-process **circuit breaker**. After the service is
  unavailable once, calls are skipped for 60 seconds, return `null`, and log at
  most once per window.

So a slow or down service costs at most ~1 second per minute per process. To
overlap it with the app's other layout work, put it in a `Promise.all`.

**Known lag:** opening Messages marks the thread read, but that runs in parallel
with the layout loader. So on the first visit the badge can still show the old
count. The badge clears on the next navigation.

**Plan gate.** Merchants must be able to message us before they pick a plan.
Exempt `/app/messages` in the layout's billing gate, next to the existing
plan-pending exemption, for example:

```js
const isGateExempt = url.pathname === "/app/plan-pending" || url.pathname === "/app/messages";
```

Do **not** add `requireEntitlementForRoute` (or the app's equivalent) to the
messages route. The kit's loader and action only call `authenticate.admin`.

## 4. Dashboard: free-setup card / help line

In the dashboard (`app._index`) loader, return `messagesEnabled: isMessagesEnabled()`
along with the app's own "setup unfinished" boolean. If setup is unfinished, also
ask whether a setup request is already open, so the card doesn't offer it again:

```js
import { isMessagesEnabled, threadSummaryForShop } from "@nerdlabs/messages-kit/server";

const summary = setupUnfinished ? await threadSummaryForShop(session.shop) : null;
return { /* … */ messagesEnabled: isMessagesEnabled(), setupRequested: summary?.setupOpen ?? false };
```

`threadSummaryForShop` returns `{ unread, setupOpen } | null`. It has the same
1-second timeout, circuit breaker and fail-open `null` as `unreadCountForShop`.

```jsx
import { FreeSetupCard, HelpLine } from "@nerdlabs/messages-kit/ui";

{setupUnfinished ? (
  <FreeSetupCard
    enabled={messagesEnabled}
    alreadyRequested={setupRequested}
    locale={locale}
    actionPath="/app/messages"
  />
) : (
  <HelpLine enabled={messagesEnabled} locale={locale} href="/app/messages" />
)}
```

- `FreeSetupCard` posts `intent=setup` to the messages action with `useFetcher`.
- Optional `email` / `name` props (e.g. from your dashboard loader) are posted along; with an email the action makes **no** Admin API lookup. Without one it looks up the shop's contact email once.
  The reply-to email comes from the shop's `contactEmail || email`, so the card
  doesn't need an email field. If the shop has no email, the card shows an email
  field. Pass `email={…}` if the app already knows a better address.
- With `alreadyRequested`, or after a request from the card, it shows "Requested! We'll email you within 1
  business day." with a link to Messages. The Messages page then shows the
  "Free setup requested" banner until we close the conversation.
- Both components render `null` when `enabled` is false.

## 5. GDPR `shop/redact`

`redactShop(shop)` deletes the shop's conversation.
- When the kit is disabled, it does nothing.
- When the kit is enabled, it **throws on any failure**: network error, timeout,
  non-2xx, or an off-contract response. The webhook must then answer non-200 so
  Shopify redelivers. Swallowing the error would quietly lose a mandatory erasure.
- The service's delete is idempotent, so redelivery is safe.

In `app/routes/webhooks.shop.redact.*`, call it in the branch that actually purges
(not the "reinstalled, nothing purged" branch). Call it after the app's own
redaction has completed:

```js
import { redactShop } from "@nerdlabs/messages-kit/server";

// … the app's own purge (sessions, shop rows) has completed above …
try {
  await redactShop(shop);
} catch (error) {
  console.error(`[shop/redact] messages redaction failed for ${shop}`, error);
  // Non-200 → Shopify redelivers. The app's own purge is idempotent and re-runs harmlessly.
  return new Response("messages redaction failed", { status: 500 });
}
return new Response();
```

## 6. Privacy policy

Add one line to the app's privacy policy (landing page plus any in-app copy):

> **Support messages.** If you message us from inside the app or request free
> setup, we store your messages, your store's myshopify domain, and the reply-to
> email and name you give us, so we can answer you by email and in the app. We
> delete them within 48 hours of receiving Shopify's shop-redact request after you
> uninstall.

---

### Exports at a glance

| `@nerdlabs/messages-kit/server` | `@nerdlabs/messages-kit/ui` |
|---|---|
| `isMessagesEnabled()` | `<MessagesPage />` |
| `createMessagesClient({ apiKey?, baseUrl? })` | `<FreeSetupCard enabled locale actionPath email? name? alreadyRequested? />` |
| `unreadCountForShop(shop)`, `threadSummaryForShop(shop)` | `<HelpLine enabled locale href />` |
| `redactShop(shop)` | `messagesNavLabel(locale, unread)` |
| `shopContact(admin)` | `t(locale, key, vars?)` |
| `messagesRoute({ app, authenticate, getLocale? })` | `resolveLocale`, `errorMessage` |
| `MessagesUnavailableError`, `MessagesRequestError` | types |
