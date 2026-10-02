# Integrating `@nerdlabs/messages-kit` into a Nerd Labs app

Per-app checklist. Every step is a few lines. Target stack: Remix 2 + Vite 6 +
Polaris 12 or 13 + App Bridge React 4 + `@shopify/shopify-app-remix`.

**Reference integration: QuickFiles** (`app/routes/app.contact.jsx`,
`app.messages.jsx`, `app.jsx`, `app._index.jsx`, `webhooks.jsx`,
`app/utils/support-nav.js`, `app/utils/admin-locale.server.js`,
`tests/unit/nerdlabs-messages.test.js`). When in doubt, copy it.

The kit is **off unless `NERDLABS_MESSAGES_KEY` is set**. Off means it makes no
network calls, the page and cards render `null`, and `unreadCountForShop` returns
`null`. Private/custom deployments (Five Dollar, Threaded Labs, …) leave the key
unset and see nothing.

---

## 1. Install + env

Pin the **release commit's HTTPS tarball**, not `github:…#tag`:

```bash
# The commit the tag points at (the "^{}" line for an annotated tag):
git ls-remote https://github.com/mpc20001/nerdlabs-messages-kit.git 'refs/tags/v1.0.0*'
# v1.0.0 → 7cacc3c9f077d0e12fc3e40f386a5011b9236248
npm i https://codeload.github.com/mpc20001/nerdlabs-messages-kit/tar.gz/7cacc3c9f077d0e12fc3e40f386a5011b9236248
```

- **Why not `github:`?** npm writes `github:` deps into the lockfile as
  `git+ssh://git@github.com/…`. A Docker `node:*-alpine` image or a CI runner
  without git or an SSH key then can't install them.
- The tarball is a plain HTTPS download, and the lockfile records its
  `integrity` hash, so the install is pinned and verified.
- `dist/` is committed, so installing needs no build step.
- Peer deps: `react ^18`, `@remix-run/node ^2`, `@remix-run/react ^2`,
  `@shopify/polaris ^12 || ^13`.

**Public App Store deployments only.** Before setting the key, the app's public
privacy policy must disclose support messages (see [§6](#6-privacy-policy)).
Then add to `/var/www/<app>/.env`:

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
import { getAdminLocale } from "../utils/admin-locale.server"; // the app's own stored-locale lookup

const messages = () =>
  messagesRoute({
    app: "QuickFiles",
    authenticate: (request) => authenticate.admin(request),
    getLocale: (request, session) => getAdminLocale(request, session.shop),
  });

export const loader = (args) => messages().loader(args);
export const action = (args) => messages().action(args);

export default function Messages() {
  return <MessagesPage />;
}
```

- Build the route inside a function (`messages()`), as shown above. Remix's client
  build removes `loader` and `action` and then drops `messages` because nothing
  uses it any more. That keeps `shopify.server` and the kit's server entry out of
  the browser bundle. A top-level `const route = messagesRoute(...)` relies on
  dead-code elimination of a call expression, so don't use it.
- **Pass `getLocale` (strongly recommended).** Resolve the locale the same way the
  `routes/app` loader does: `?locale=` if present, then the locale the app stored
  for the shop, then `"en"`. App Bridge nav links drop Shopify's `?locale=` param,
  so without `getLocale`:
  - the page renders in the locale from the query param, or `"en"`;
  - the action uses the locale the kit's UI posts, then the query param, then
    `"en"`, to localize the service's system message and emails.

  If `getLocale` throws or returns nothing, the kit falls through to those same
  sources.
- The App Bridge title bar is optional. Add `<TitleBar title="Messages" />` next
  to `<MessagesPage />` if you want one.

### Redirect the old contact page (enabled only)

`app/routes/app.contact.jsx` keeps its form for the disabled case (private
deployments, local dev) and redirects only when `isMessagesEnabled()`:

```jsx
import { json, redirect } from "@remix-run/node"; // Remix's redirect, NOT the one from authenticate.admin
import { isMessagesEnabled } from "@nerdlabs/messages-kit/server";
import { authenticate } from "../shopify.server";

// Only the params an embedded DOCUMENT load needs to authenticate without a bounce.
const EMBEDDED_PARAMS = ["shop", "host", "embedded", "locale", "id_token"];

export function messagesRedirectTarget(requestUrl) {
  const url = new URL(requestUrl);
  const target = new URLSearchParams();
  for (const key of EMBEDDED_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) target.set(key, value);
  }
  const qs = target.toString();
  return qs ? `/app/messages?${qs}` : "/app/messages";
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  if (isMessagesEnabled()) return redirect(messagesRedirectTarget(request.url));
  return json({ shop: session.shop }); // the existing contact form, unchanged
};
```

**Do not** use either of these:

- ``redirect(`/app/messages${new URL(request.url).search}`)``, which forwards the
  whole query string;
- the `redirect` that `authenticate.admin` returns (shopify-app-remix), which
  copies every param.

Both copy Remix's `_data` param on client navigations. The admin URL becomes
`/app/messages?_data=routes/app.contact`, and a refresh renders a raw 403 "Route
does not match URL" in the iframe.

## 3. Nav link, unread badge, plan-gate exemption

### Layout loader (`app/routes/app.jsx`)

Start the unread count **early and un-awaited**, right after `authenticate.admin`,
so it overlaps the loader's existing awaits instead of adding to them. On
LCP-sensitive layouts, race it with a ~250 ms timer:

```js
import { isMessagesEnabled, unreadCountForShop } from "@nerdlabs/messages-kit/server";

// Right after authenticate.admin. Never rejects; null when off, slow or down.
const messagesUnreadPromise = Promise.race([
  unreadCountForShop(session.shop),
  new Promise((resolve) => setTimeout(() => resolve(null), 250)),
]);

// … the loader's existing work (billing read, GraphQL, …) …

// On EVERY return path that renders the app (fast path AND slow path):
const messagesUnread = await messagesUnreadPromise;
return json({ /* … */ messagesEnabled: isMessagesEnabled(), messagesUnread });
```

If one return path omits the fields, the nav silently falls back to the old link
for merchants on that path.

`unreadCountForShop` is built for every page load:
- It's one call with a **1-second timeout**.
- It returns `null` when the kit is disabled or on any error, and never throws.
- It sits behind an in-process **circuit breaker**. After the service is
  unavailable once, calls are skipped for 60 seconds, return `null`, and log at
  most once per window.

The 250 ms race stops a hung service (before the breaker trips) from adding a
full second to the load. The badge shows without a count that once.

**Known lag:** opening Messages marks the thread read, but that runs in parallel
with the layout loader. So on the first visit the badge can still show the old
count. The badge clears on the next navigation.

### Nav: swap the Help item, don't add a second one

`app/utils/support-nav.js` (QuickFiles):

```js
import { messagesNavLabel } from "@nerdlabs/messages-kit/ui";

const GATE_EXEMPT_PATHS = ["/app/contact", "/app/messages"];

// Exact path or a sub-path only, so "/app/messagesx" is NOT exempt.
export function isPlanGateExempt(pathname) {
  if (typeof pathname !== "string") return false;
  return GATE_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function helpNavLink({ messagesEnabled, messagesUnread, locale, tt }) {
  if (messagesEnabled) {
    return { href: "/app/messages", label: messagesNavLabel(locale, messagesUnread ?? 0) };
  }
  return { href: "/app/contact", label: tt("nav.help") };
}
```

In the layout component, use plain `<a>` elements in App Bridge's `NavMenu`, as
the rest of the fleet does:

```jsx
const { locale, messagesEnabled, messagesUnread /* … */ } = useLoaderData();
const helpLink = helpNavLink({ messagesEnabled, messagesUnread, locale, tt });

<NavMenu>
  {/* … */}
  <a href={helpLink.href}>{helpLink.label}</a>
</NavMenu>
```

### Plan gate

Merchants must be able to message us before they pick a plan. Exempt
`/app/messages` wherever the layout's billing gate already exempts the contact
or plan-pending page:

```jsx
const { pathname } = useLocation();
{!hasSubscription && !isPlanGateExempt(pathname) ? <PlanGate /> : <Outlet />}
```

Don't use `pathname.startsWith("/app/messages")`: it also lets `/app/messagesx`
through.

Do **not** add `requireEntitlementForRoute` (or the app's equivalent) to the
messages route. The kit's loader and action only call `authenticate.admin`.

## 4. Dashboard: free-setup card / help line

`threadSummaryForShop(shop)` returns `{ unread, setupOpen } | null`. It has the
same 1-second timeout, circuit breaker and fail-open `null` as
`unreadCountForShop`. Read `messagesEnabled` from the layout's loader data
(`useRouteLoaderData("routes/app")`) or return it from the dashboard loader.

**One-banner rule.** `FreeSetupCard`'s "Requested!" and error states are Polaris
Banners. When a setup request is already open (`setupOpen`), render `<HelpLine>`
instead of the card. Don't pass `alreadyRequested` to a card that sits near the
app's own page-level banner, or the merchant sees two banners (BFS 4.3.4).

### Plain loader

```js
import { isMessagesEnabled, threadSummaryForShop } from "@nerdlabs/messages-kit/server";

const summaryPromise = threadSummaryForShop(session.shop).catch(() => null); // start early
// … the loader's own work, which computes setupUnfinished …
const setupOpen = setupUnfinished ? (await summaryPromise)?.setupOpen === true : false;
return json({ /* … */ setupUnfinished, setupOpen, messagesEnabled: isMessagesEnabled() });
```

```jsx
import { FreeSetupCard, HelpLine } from "@nerdlabs/messages-kit/ui";

{setupUnfinished && !setupOpen ? (
  <FreeSetupCard enabled={messagesEnabled} locale={locale} actionPath="/app/messages" />
) : (
  <HelpLine enabled={messagesEnabled} locale={locale} href="/app/messages" />
)}
```

### Deferred loader (`defer()`)

If "setup unfinished" comes from `defer()`ed data, start the summary at the top
of the deferred function so it runs in parallel, and put the card inside
`<Suspense><Await>`:

```js
async function loadDashboardData(shop, admin) {
  const summary = threadSummaryForShop(shop).catch(() => null); // started first, awaited last
  // … the heavy queries …
  return { /* … */ messagesSetupOpen: (await summary)?.setupOpen === true };
}
```

```jsx
<Suspense fallback={null}>
  <Await resolve={dashboardData}>
    {(data) =>
      !isSetupUnfinished(data) ? null : data.messagesSetupOpen ? (
        <HelpLine enabled={messagesEnabled} locale={locale} href="/app/messages" />
      ) : (
        <FreeSetupCard enabled={messagesEnabled} locale={locale} actionPath="/app/messages" />
      )
    }
  </Await>
</Suspense>
```

Return `messagesSetupOpen` from the deferred function's error/fallback branch
too.

### Keep "Requested!" on screen

After the card's submit, Remix revalidates the dashboard by default. The fresh
data says a setup request is open, the card is swapped for the help line, and
the "Requested!" confirmation vanishes the instant it appears. Skip that
revalidation in the dashboard route:

```js
export function shouldRevalidate({ formAction, defaultShouldRevalidate }) {
  if (formAction && new URL(formAction, "https://x.invalid").pathname === "/app/messages") return false;
  return defaultShouldRevalidate;
}
```

### Card notes

- `FreeSetupCard` posts `intent=setup` to the messages action with `useFetcher`.
  The reply-to email comes from the shop's `contactEmail || email`, so the card
  doesn't need an email field. If the shop has no email, the card shows an email
  field.
- Optional `email` / `name` props (e.g. from your dashboard loader) are posted
  along: with an email the action makes **no** Admin API lookup; without one it
  looks up the shop's contact email once.
- After a request, the card shows "Requested! We'll email you within 1 business
  day." with a link to Messages. The Messages page then shows the "Free setup
  requested" banner until we close the conversation.
- Both components render `null` when `enabled` is false.

## 5. GDPR `shop/redact`

`redactShop(shop)` deletes the shop's conversation.
- When the kit is disabled, it does nothing.
- When the kit is enabled, it **throws on any failure**: network error, timeout,
  non-2xx, or an off-contract response.
- The service's delete is idempotent, so redelivery is safe.

In the `shop/redact` handler, in the branch that actually purges (not the
"reinstalled, nothing purged" branch):

1. Run every local purge first.
2. Run **every** external erasure, even if an earlier one failed. Collect the
   failures instead of returning early.
3. Call `redactShop` **last**.
4. If anything failed, throw a single 5xx so Shopify redelivers. Swallowing the
   error would quietly lose a mandatory erasure.

```js
import { redactShop } from "@nerdlabs/messages-kit/server";

// … the app's own purge (sessions, shop rows, files) has completed above …
const failures = [];
try {
  await eraseShopEmail(shop); // the app's other external erasures, each in its own try
} catch (e) {
  failures.push("shop-email erasure");
  console.error(`[shop/redact] shop-email erasure failed for ${shop}`, e);
}
try {
  await redactShop(shop); // last
} catch (e) {
  failures.push("messages redaction");
  console.error(`[shop/redact] messages redaction failed for ${shop}`, e);
}
if (failures.length) {
  // Non-200 → Shopify redelivers. Every step above is idempotent.
  throw new Response(`${failures.join(", ")} failed`, { status: 500 });
}
```

## 6. Privacy policy

**The app's public privacy policy must disclose support messages before
`NERDLABS_MESSAGES_KEY` is set.** Update the landing page and any in-app copy.
QuickFiles' wording (`nerdlabs-landing/quickfiles-landing/privacy.html`):

- **Information we collect:**
  > **Support Messages:** If you message us from inside the app (including a
  > free-setup request), we store your messages, your shop domain, the reply-to
  > email address and name you provide or that Shopify lists for your store, and
  > your admin language — used only to answer you and to email you when we reply.
- **How we use it:**
  > Provide customer support, including in-app support messages and free setup help
- **Retention:**
  > **Support messages** are deleted together with your store data when Shopify
  > sends its store-deletion (SHOP_REDACT) request, or sooner on request

Bump the policy's "Last updated" date.

## 7. Testing

Vitest doesn't transform `node_modules`, so `vi.mock("@remix-run/react")` never
reaches the kit's UI. A render test of a route that includes the kit's
components fails with "useFetcher must be used within a data router". Pick one:

- **Inline the kit** so vitest transforms it and your mocks apply:

  ```js
  // vitest.config.js
  export default defineConfig({
    test: { server: { deps: { inline: ["@nerdlabs/messages-kit"] } } },
  });
  ```

- **Render inside a real router** with Remix's `createRemixStub` (from
  `@remix-run/testing`).
- **Mock the kit's server entry** and test the app-side wiring only, as
  QuickFiles does:

  ```js
  const kit = vi.hoisted(() => ({
    isMessagesEnabled: vi.fn(() => false),
    unreadCountForShop: vi.fn(async () => null),
    threadSummaryForShop: vi.fn(async () => null),
    redactShop: vi.fn(async () => {}),
  }));
  vi.mock("@nerdlabs/messages-kit/server", () => kit);
  ```

  Worth covering: the contact redirect drops `_data` but keeps the embedded
  params, `isPlanGateExempt("/app/messagesx")` is false, every layout return
  path has `messagesEnabled`/`messagesUnread`, `redactShop` runs after the purge
  and a failure gives a 500, and `shouldRevalidate` skips `/app/messages`.

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
