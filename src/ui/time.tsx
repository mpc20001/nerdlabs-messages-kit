import { useEffect, useState } from "react";

/**
 * True after the first client effect. Anything that depends on the viewer's
 * clock or time zone renders a stable UTC form until then, so the SSR markup
 * and the first client render match (no hydration mismatch) and nothing
 * touches `window` during SSR.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** `Date.now()` that ticks every minute once hydrated; `null` during SSR/first render. */
export function useNow(intervalMs = 60_000): number | null {
  const hydrated = useHydrated();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!hydrated) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [hydrated, intervalMs]);
  return now;
}

function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat("en", options);
  }
}

function relativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Absolute date + time. `timeZone` undefined = the viewer's zone. */
export function formatAbsolute(iso: string, locale: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return dateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(
    date,
  );
}

/**
 * Localized "time ago" for recent messages, absolute local date/time for older
 * ones. With `now === null` (SSR / pre-hydration) returns a deterministic UTC
 * absolute form instead.
 */
export function formatMessageTime(iso: string, locale: string, now: number | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (now === null) return formatAbsolute(iso, locale, "UTC");

  const diff = date.getTime() - now; // negative = past
  const abs = Math.abs(diff);
  const rtf = relativeTimeFormat(locale);
  if (abs < MINUTE) return rtf.format(0, "second");
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  return formatAbsolute(iso, locale);
}
