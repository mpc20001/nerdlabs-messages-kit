import { en, type Dictionary, type MessageKey } from "./en.js";
import {
  cs,
  da,
  de,
  es,
  fi,
  fr,
  it,
  ja,
  ko,
  nb,
  nl,
  pl,
  ptBR,
  ptPT,
  sv,
  th,
  tr,
  vi,
  zhCN,
  zhTW,
} from "./locales.js";

export type { Dictionary, MessageKey };

export const SUPPORTED_LOCALES = [
  "en",
  "cs",
  "da",
  "de",
  "es",
  "fi",
  "fr",
  "it",
  "ja",
  "ko",
  "nb",
  "nl",
  "pl",
  "pt-BR",
  "pt-PT",
  "sv",
  "th",
  "tr",
  "vi",
  "zh-CN",
  "zh-TW",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DICTIONARIES: Readonly<Record<SupportedLocale, Dictionary>> = {
  en,
  cs,
  da,
  de,
  es,
  fi,
  fr,
  it,
  ja,
  ko,
  nb,
  nl,
  pl,
  "pt-BR": ptBR,
  "pt-PT": ptPT,
  sv,
  th,
  tr,
  vi,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

/** Lower-cased exact tag → supported locale. */
const EXACT: ReadonlyMap<string, SupportedLocale> = new Map(
  SUPPORTED_LOCALES.map((l) => [l.toLowerCase(), l] as const),
);

/**
 * Regional / script variants that a plain language-prefix fallback would get
 * wrong (Traditional-Chinese regions, Norwegian macro-language codes).
 */
const ALIASES: ReadonlyMap<string, SupportedLocale> = new Map([
  ["zh-hant", "zh-TW"],
  ["zh-hk", "zh-TW"],
  ["zh-mo", "zh-TW"],
  ["zh-hans", "zh-CN"],
  ["zh-sg", "zh-CN"],
  ["no", "nb"],
  ["nn", "nb"],
]);

/** Bare language code → default regional variant. */
const LANGUAGE_DEFAULT: ReadonlyMap<string, SupportedLocale> = new Map([
  ["pt", "pt-BR"],
  ["zh", "zh-CN"],
]);

/**
 * Resolve any BCP-47-ish tag ("de", "de-AT", "pt_PT", "zh-Hant-HK", "EN-us")
 * to one of the kit's supported locales.
 * Order: exact → known alias → language-prefix → "en".
 */
export function resolveLocale(input: string | null | undefined): SupportedLocale {
  if (typeof input !== "string") return "en";
  const tag = input.trim().replace(/_/g, "-").toLowerCase();
  if (!tag) return "en";

  const exact = EXACT.get(tag);
  if (exact) return exact;

  // Try progressively shorter prefixes: "zh-hant-hk" → "zh-hant" → "zh".
  const parts = tag.split("-");
  for (let n = parts.length; n >= 1; n--) {
    const prefix = parts.slice(0, n).join("-");
    const hit = ALIASES.get(prefix) ?? (n < parts.length ? EXACT.get(prefix) : undefined);
    if (hit) return hit;
  }

  const language = parts[0] ?? "";
  return LANGUAGE_DEFAULT.get(language) ?? EXACT.get(language) ?? "en";
}

/** Shared constants used by both the server action and the UI. */
export const SUPPORT_EMAIL = "support@nerdlabs.us";
export const MAX_BODY_LENGTH = 5000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_EMAIL_LENGTH = 200;

export type TranslationVars = Readonly<Record<string, string | number>>;

export function isMessageKey(key: unknown): key is MessageKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(en, key);
}

/**
 * Translate `key` for `locale`, substituting `{var}` placeholders.
 * Unknown placeholders are left as-is so a missing var is visible, not silent.
 */
export function t(locale: string | null | undefined, key: MessageKey, vars?: TranslationVars): string {
  const dict = DICTIONARIES[resolveLocale(locale)];
  const template = dict[key] ?? en[key];
  if (!vars) return template;
  // Function replacer: values are inserted literally (no `$&`/`$1` expansion).
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** "Messages" or "Messages (2)" for the app's nav link. */
export function messagesNavLabel(locale: string | null | undefined, unread?: number | null): string {
  const count = typeof unread === "number" && Number.isFinite(unread) ? Math.floor(unread) : 0;
  return count > 0 ? t(locale, "nav.messagesWithCount", { count }) : t(locale, "nav.messages");
}


/** Localized text for an action error key, with its `{email}` / `{max}` filled in. */
export function errorMessage(locale: string | null | undefined, key: MessageKey): string {
  const max = key === "error.noteTooLong" ? MAX_NOTE_LENGTH : MAX_BODY_LENGTH;
  return t(locale, key, { email: SUPPORT_EMAIL, max });
}
