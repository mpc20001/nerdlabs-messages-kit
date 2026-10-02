import { resolveLocale, t, SUPPORT_EMAIL, isMessageKey, errorMessage, MAX_NOTE_LENGTH, MAX_EMAIL_LENGTH, MAX_BODY_LENGTH } from './shared-chunk.js';
export { SUPPORTED_LOCALES, SUPPORT_EMAIL, errorMessage, isMessageKey, messagesNavLabel, resolveLocale, t } from './shared-chunk.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { Page, Banner, BlockStack, Card, Text, InlineStack, Button, TextField, FormLayout, Box } from '@shopify/polaris';
import { jsx, jsxs } from 'react/jsx-runtime';

function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
function useNow(intervalMs = 6e4) {
  const hydrated = useHydrated();
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (!hydrated) return void 0;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [hydrated, intervalMs]);
  return now;
}
function dateTimeFormat(locale, options) {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat("en", options);
  }
}
function relativeTimeFormat(locale) {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
}
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
function formatAbsolute(iso, locale, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return dateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", ...timeZone ? { timeZone } : {} }).format(
    date
  );
}
function formatMessageTime(iso, locale, now) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (now === null) return formatAbsolute(iso, locale, "UTC");
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const rtf = relativeTimeFormat(locale);
  if (abs < MINUTE) return rtf.format(0, "second");
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  return formatAbsolute(iso, locale);
}
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var AUTHOR_KEY = {
  merchant: "author.you",
  admin: "author.admin",
  system: "author.system"
};
function fieldForError(key) {
  if (key === "error.bodyRequired" || key === "error.bodyTooLong") return "body";
  if (key === "error.emailRequired" || key === "error.emailInvalid") return "email";
  return null;
}
function MessageBubble({ message, locale, now }) {
  const mine = message.author === "merchant";
  const time = formatMessageTime(message.createdAt, locale, now);
  return /* @__PURE__ */ jsx(InlineStack, { align: mine ? "end" : "start", children: /* @__PURE__ */ jsx("div", { style: { maxWidth: "80%", minWidth: 0 }, "data-author": message.author, children: /* @__PURE__ */ jsxs(BlockStack, { gap: "100", inlineAlign: mine ? "end" : "start", children: [
    /* @__PURE__ */ jsxs(Text, { as: "span", variant: "bodySm", tone: "subdued", children: [
      t(locale, AUTHOR_KEY[message.author]),
      time ? " \xB7 " : "",
      time ? /* @__PURE__ */ jsx("time", { dateTime: message.createdAt, title: now === null ? void 0 : formatAbsolute(message.createdAt, locale), children: time }) : null
    ] }),
    /* @__PURE__ */ jsx(
      Box,
      {
        padding: "300",
        borderRadius: "300",
        background: mine ? "bg-fill-info-secondary" : "bg-surface-secondary",
        children: /* @__PURE__ */ jsx("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, children: /* @__PURE__ */ jsx(Text, { as: "p", variant: "bodyMd", children: message.body }) })
      }
    )
  ] }) }) });
}
function Thread({ messages, locale }) {
  const now = useNow();
  const scrollRef = useRef(null);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);
  if (messages.length === 0) {
    return /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t(locale, "page.empty") });
  }
  return /* @__PURE__ */ jsx("div", { ref: scrollRef, style: { maxHeight: "60vh", overflowY: "auto" }, role: "log", "aria-live": "polite", children: /* @__PURE__ */ jsx(BlockStack, { gap: "400", children: messages.map((message) => /* @__PURE__ */ jsx(MessageBubble, { message, locale, now }, message.id)) }) });
}
function Composer({
  locale,
  localeExplicit,
  defaultEmail,
  actionPath
}) {
  const fetcher = useFetcher();
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [sent, setSent] = useState(false);
  const submitting = fetcher.state !== "idle";
  const data = fetcher.data;
  useEffect(() => {
    if (fetcher.state !== "idle" || !data) return;
    if (data.ok) {
      if (data.intent === "send") {
        setBody("");
        setSent(true);
      }
      return;
    }
    const key = isMessageKey(data.error) ? data.error : "error.generic";
    const field = fieldForError(key);
    if (field) setFieldErrors({ [field]: key });
    else setFormError(key);
  }, [data, fetcher.state]);
  const submit = useCallback(() => {
    const trimmedBody = body.trim();
    const trimmedEmail = email.trim();
    const errors = {};
    if (!trimmedBody) errors.body = "error.bodyRequired";
    else if (trimmedBody.length > MAX_BODY_LENGTH) errors.body = "error.bodyTooLong";
    if (trimmedEmail && (trimmedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmedEmail))) {
      errors.email = "error.emailInvalid";
    }
    setFieldErrors(errors);
    setFormError(null);
    setSent(false);
    if (errors.body || errors.email) return;
    fetcher.submit(
      // `locale` lets the action localize system mail even when the app has no getLocale.
      // `locale` only when real: the "en" display default must not overwrite
      // the merchant's stored locale on the service.
      { intent: "send", body: trimmedBody, merchantEmail: trimmedEmail, ...localeExplicit ? { locale } : {} },
      { method: "post", ...actionPath ? { action: actionPath } : {} }
    );
  }, [body, email, locale, localeExplicit, actionPath, fetcher]);
  return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
    "form",
    {
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      },
      children: /* @__PURE__ */ jsxs(FormLayout, { children: [
        sent ? /* @__PURE__ */ jsx(Banner, { tone: "success", onDismiss: () => setSent(false), children: /* @__PURE__ */ jsx("p", { children: t(locale, "composer.sent") }) }) : null,
        formError ? /* @__PURE__ */ jsx(Banner, { tone: "critical", onDismiss: () => setFormError(null), children: /* @__PURE__ */ jsx("p", { children: errorMessage(locale, formError) }) }) : null,
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: t(locale, "composer.label"),
            placeholder: t(locale, "composer.placeholder"),
            value: body,
            onChange: (value) => {
              setBody(value);
              if (fieldErrors.body) setFieldErrors((prev) => ({ ...prev, body: void 0 }));
            },
            multiline: 4,
            maxLength: MAX_BODY_LENGTH,
            showCharacterCount: true,
            autoComplete: "off",
            error: fieldErrors.body ? errorMessage(locale, fieldErrors.body) : void 0,
            disabled: submitting
          }
        ),
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: t(locale, "composer.emailLabel"),
            helpText: t(locale, "composer.emailHelp"),
            type: "email",
            value: email,
            onChange: (value) => {
              setEmail(value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: void 0 }));
            },
            maxLength: MAX_EMAIL_LENGTH,
            autoComplete: "email",
            error: fieldErrors.email ? errorMessage(locale, fieldErrors.email) : void 0,
            disabled: submitting
          }
        ),
        /* @__PURE__ */ jsx(InlineStack, { align: "end", children: /* @__PURE__ */ jsx(Button, { variant: "primary", submit: true, loading: submitting, children: t(locale, "composer.send") }) })
      ] })
    }
  ) });
}
function MessagesPage({ locale: localeProp, actionPath } = {}) {
  const data = useLoaderData();
  if (!data || !data.enabled) return null;
  const locale = resolveLocale(localeProp ?? data.locale);
  if (data.unavailable) {
    return /* @__PURE__ */ jsx(Page, { title: t(locale, "page.title"), children: /* @__PURE__ */ jsx(Banner, { tone: "warning", children: /* @__PURE__ */ jsx("p", { children: t(locale, "error.unavailable", { email: SUPPORT_EMAIL }) }) }) });
  }
  const setupPending = data.conversation?.kind === "setup" && data.conversation.status !== "closed";
  return /* @__PURE__ */ jsx(Page, { title: t(locale, "page.title"), children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
    setupPending ? /* @__PURE__ */ jsx(Banner, { tone: "info", children: /* @__PURE__ */ jsx("p", { children: t(locale, "setup.requestedBanner") }) }) : null,
    /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "400", children: [
      /* @__PURE__ */ jsx(Text, { as: "p", tone: "subdued", children: t(locale, "page.subtitle", { app: data.app }) }),
      /* @__PURE__ */ jsx(Thread, { messages: data.messages, locale })
    ] }) }),
    /* @__PURE__ */ jsx(
      Composer,
      {
        locale,
        localeExplicit: Boolean(localeProp) || data.localeExplicit === true,
        defaultEmail: data.contact.email,
        actionPath
      }
    )
  ] }) });
}
function FreeSetupCard({
  enabled,
  locale: localeProp,
  actionPath = "/app/messages",
  messagesHref,
  email: emailProp,
  alreadyRequested = false
}) {
  const locale = resolveLocale(localeProp);
  const fetcher = useFetcher();
  const [note, setNote] = useState("");
  const [email, setEmail] = useState(emailProp ?? "");
  const [needsEmail, setNeedsEmail] = useState(false);
  const [error, setError] = useState(null);
  const [requested, setRequested] = useState(false);
  const submitting = fetcher.state !== "idle";
  const data = fetcher.data;
  useEffect(() => {
    if (fetcher.state !== "idle" || !data) return;
    if (data.ok) {
      if (data.intent === "setup") setRequested(true);
      return;
    }
    const key = isMessageKey(data.error) ? data.error : "error.generic";
    if (key === "error.emailRequired" || key === "error.emailInvalid") setNeedsEmail(true);
    setError(key);
  }, [data, fetcher.state]);
  if (!enabled) return null;
  const href = messagesHref ?? actionPath;
  if (requested || alreadyRequested) {
    return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
      /* @__PURE__ */ jsx(Banner, { tone: "success", children: /* @__PURE__ */ jsx("p", { children: t(locale, "setupCard.success") }) }),
      /* @__PURE__ */ jsx(InlineStack, { children: /* @__PURE__ */ jsx(Button, { url: href, children: t(locale, "setupCard.viewMessages") }) })
    ] }) });
  }
  const emailError = error === "error.emailRequired" || error === "error.emailInvalid" ? error : null;
  const noteError = error === "error.noteTooLong" ? error : null;
  const formError = error && !emailError && !noteError ? error : null;
  const submit = () => {
    const trimmedNote = note.trim();
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      setError("error.noteTooLong");
      return;
    }
    setError(null);
    fetcher.submit(
      // Only a locale the app actually passed (not the "en" display default).
      { intent: "setup", body: trimmedNote, merchantEmail: email.trim(), ...localeProp ? { locale } : {} },
      { method: "post", action: actionPath }
    );
  };
  return /* @__PURE__ */ jsx(Card, { children: /* @__PURE__ */ jsx(
    "form",
    {
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      },
      children: /* @__PURE__ */ jsxs(BlockStack, { gap: "300", children: [
        /* @__PURE__ */ jsx(Text, { as: "h2", variant: "headingMd", children: t(locale, "setupCard.title") }),
        /* @__PURE__ */ jsx(Text, { as: "p", children: t(locale, "setupCard.body") }),
        formError ? /* @__PURE__ */ jsx(Banner, { tone: "critical", onDismiss: () => setError(null), children: /* @__PURE__ */ jsx("p", { children: errorMessage(locale, formError) }) }) : null,
        /* @__PURE__ */ jsx(
          TextField,
          {
            label: t(locale, "setupCard.noteLabel"),
            value: note,
            onChange: (value) => {
              setNote(value);
              if (noteError) setError(null);
            },
            multiline: 3,
            maxLength: MAX_NOTE_LENGTH,
            showCharacterCount: true,
            autoComplete: "off",
            error: noteError ? errorMessage(locale, noteError) : void 0,
            disabled: submitting
          }
        ),
        needsEmail ? /* @__PURE__ */ jsx(
          TextField,
          {
            label: t(locale, "composer.emailLabel"),
            type: "email",
            value: email,
            onChange: (value) => {
              setEmail(value);
              if (emailError) setError(null);
            },
            maxLength: MAX_EMAIL_LENGTH,
            autoComplete: "email",
            error: emailError ? errorMessage(locale, emailError) : void 0,
            disabled: submitting
          }
        ) : null,
        /* @__PURE__ */ jsx(InlineStack, { children: /* @__PURE__ */ jsx(Button, { variant: "primary", submit: true, loading: submitting, children: t(locale, "setupCard.button") }) })
      ] })
    }
  ) });
}
function HelpLine({ enabled, locale, href = "/app/messages" }) {
  if (!enabled) return null;
  return /* @__PURE__ */ jsxs(InlineStack, { gap: "200", blockAlign: "center", wrap: true, children: [
    /* @__PURE__ */ jsx(Text, { as: "span", tone: "subdued", children: t(locale, "helpLine.text") }),
    /* @__PURE__ */ jsx(Button, { variant: "plain", url: href, children: t(locale, "helpLine.button") })
  ] });
}

export { FreeSetupCard, HelpLine, MessagesPage, formatMessageTime };
