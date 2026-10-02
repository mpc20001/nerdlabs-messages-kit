# @nerdlabs/messages-kit

This package adds an in-app support chat to every public Nerd Labs Shopify app,
with one shared admin inbox. It is the client side of the
[Nerd Labs Messages App API v1](../nerdlabs-messages/API.md).

- **`@nerdlabs/messages-kit/server`** is Node-only: the service client, a
  Remix loader + action for `/app/messages`, the unread count for the nav badge,
  the GDPR redact helper and the shop contact lookup.
- **`@nerdlabs/messages-kit/ui`** holds the Polaris components (peer dep
  `@shopify/polaris ^12 || ^13`): `MessagesPage`,
  `FreeSetupCard`, `HelpLine`, plus `messagesNavLabel` and `t`.

All strings are localized in 21 locales: en, cs, da, de, es, fi, fr, it, ja, ko,
nb, nl, pl, pt-BR, pt-PT, sv, th, tr, vi, zh-CN, zh-TW. Fallback order: exact
match, then known alias or language prefix (`pt` becomes `pt-BR`, `zh` becomes
`zh-CN`, `zh-Hant`/`zh-HK` become `zh-TW`, `no` becomes `nb`), then `en`.

**Per-app setup: see [INTEGRATION.md](./INTEGRATION.md).**

## Behaviour

- **Off by default.** With no `NERDLABS_MESSAGES_KEY`, the kit makes no calls, the
  components render `null`, `unreadCountForShop` and `threadSummaryForShop`
  return `null`, and `redactShop` does nothing. That's the setting for
  private/custom deployments.
- **Fails open.** Calls time out after 3 seconds, except posting a message (8
  seconds) and the per-page-load helpers `unreadCountForShop` and
  `threadSummaryForShop`. Those get 1 second plus a 60-second circuit breaker.
  If the service is down, slow or answers 5xx, the page shows "Messages are unavailable right now — email
  support@nerdlabs.us". Nothing the kit does produces a 500 page. Only the app's
  own `authenticate.admin` redirects propagate.
- **The one exception: `redactShop` throws** when the kit is enabled and the
  delete fails. The GDPR webhook then answers non-200 and Shopify redelivers.
- **Server-to-server only.** Calls go to `NERDLABS_MESSAGES_URL` (default
  `http://127.0.0.1:3027`) with `Authorization: Bearer <key>`, and redirects are
  never followed.
- **SSR-safe.** Components never touch `window` while rendering. Timestamps
  render as a fixed UTC date on the server and switch to localized relative time
  ("5 minutes ago") after hydration, so the server and client markup match.
- **Validation messages appear on the field** (Built for Shopify 4.2.4): a body
  or email error shows on its own input. Rate limits and outages show in a banner.

## Errors

| Situation | Client throws | Action returns |
|---|---|---|
| network error / timeout / 5xx / bad JSON | `MessagesUnavailableError` | `503 { ok:false, error:"error.unavailable" }` |
| `429 rate_limited` | `MessagesRequestError(429, "rate_limited")` | `429 … "error.rateLimited"` |
| `400 invalid_email` / `invalid_body` | `MessagesRequestError(400, code)` | `400 … "error.emailInvalid"` / `"error.bodyRequired"` |
| `401` / other 4xx | `MessagesRequestError` | `503 … "error.unavailable"` (logged) |

The `error` values are i18n keys. Pass one to `errorMessage(locale, key)` or
`t(locale, key, vars)` to get the text.

## Development

```bash
npm install
npm run typecheck
npm test          # vitest: client, real-HTTP fake service, route, i18n parity, SSR renders
npm run build     # tsup → dist/ (commit dist/; there is intentionally no `prepare` script)
```

Releasing: bump `version`, `npm run build`, commit `dist/`, then tag `vX.Y.Z`.

Apps pin the tag's **commit** as an HTTPS tarball, not `github:…#vX.Y.Z`. npm
records `github:` deps as `git+ssh://` in the lockfile, and Docker
`node:*-alpine` or CI without git/SSH can't install them:

```bash
git ls-remote https://github.com/mpc20001/nerdlabs-messages-kit.git 'refs/tags/vX.Y.Z*'  # use the ^{} sha
npm i https://codeload.github.com/mpc20001/nerdlabs-messages-kit/tar.gz/<commit-sha>
```

The lockfile records the tarball's `integrity` hash, so the install is pinned.
