import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  errorMessage,
  isMessageKey,
  MAX_BODY_LENGTH,
  MAX_EMAIL_LENGTH,
  SUPPORT_EMAIL,
  t,
  type MessageKey,
} from "../i18n/index.js";
import type { Author, Message, MessagesActionData, MessagesLoaderData } from "../types.js";
import { formatAbsolute, formatMessageTime, useNow } from "./time.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTHOR_KEY: Record<Author, MessageKey> = {
  merchant: "author.you",
  admin: "author.admin",
  system: "author.system",
};

export type MessagesPageProps = {
  /** Overrides the locale from loader data. */
  locale?: string;
  /** Where the composer posts. Defaults to the current route (the one exporting `messagesRoute().action`). */
  actionPath?: string;
};

type FieldErrors = { body?: MessageKey; email?: MessageKey };

/** Which input a server error key belongs on (BFS: validation errors render on the field). */
function fieldForError(key: MessageKey): keyof FieldErrors | null {
  if (key === "error.bodyRequired" || key === "error.bodyTooLong") return "body";
  if (key === "error.emailRequired" || key === "error.emailInvalid") return "email";
  return null;
}

function MessageBubble({ message, locale, now }: { message: Message; locale: string; now: number | null }) {
  const mine = message.author === "merchant";
  const time = formatMessageTime(message.createdAt, locale, now);
  return (
    <InlineStack align={mine ? "end" : "start"}>
      <div style={{ maxWidth: "80%", minWidth: 0 }} data-author={message.author}>
        <BlockStack gap="100" inlineAlign={mine ? "end" : "start"}>
          <Text as="span" variant="bodySm" tone="subdued">
            {t(locale, AUTHOR_KEY[message.author])}
            {time ? " · " : ""}
            {time ? (
              <time dateTime={message.createdAt} title={now === null ? undefined : formatAbsolute(message.createdAt, locale)}>
                {time}
              </time>
            ) : null}
          </Text>
          <Box
            padding="300"
            borderRadius="300"
            background={mine ? "bg-fill-info-secondary" : "bg-surface-secondary"}
          >
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              <Text as="p" variant="bodyMd">
                {message.body}
              </Text>
            </div>
          </Box>
        </BlockStack>
      </div>
    </InlineStack>
  );
}

function Thread({ messages, locale }: { messages: Message[]; locale: string }) {
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    // Client-only: keep the newest message in view on load and after a send.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  if (messages.length === 0) {
    return (
      <Text as="p" tone="subdued">
        {t(locale, "page.empty")}
      </Text>
    );
  }
  return (
    <div ref={scrollRef} style={{ maxHeight: "60vh", overflowY: "auto" }} role="log" aria-live="polite">
      <BlockStack gap="400">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} locale={locale} now={now} />
        ))}
      </BlockStack>
    </div>
  );
}

function Composer({
  locale,
  defaultEmail,
  actionPath,
}: {
  locale: string;
  defaultEmail: string;
  actionPath: string | undefined;
}) {
  const fetcher = useFetcher<MessagesActionData>();
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);
  const submitting = fetcher.state !== "idle";
  const data = fetcher.data as MessagesActionData | undefined;

  useEffect(() => {
    if (fetcher.state !== "idle" || !data) return;
    if (data.ok) {
      if (data.intent === "send") {
        setBody("");
        setSent(true);
      }
      return;
    }
    const key: MessageKey = isMessageKey(data.error) ? data.error : "error.generic";
    const field = fieldForError(key);
    if (field) setFieldErrors({ [field]: key });
    else setFormError(key);
    // Only react to a new result, not to keystrokes.
  }, [data, fetcher.state]);

  const submit = useCallback(() => {
    const trimmedBody = body.trim();
    const trimmedEmail = email.trim();
    const errors: FieldErrors = {};
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
      { intent: "send", body: trimmedBody, merchantEmail: trimmedEmail },
      { method: "post", ...(actionPath ? { action: actionPath } : {}) },
    );
  }, [body, email, actionPath, fetcher]);

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FormLayout>
          {sent ? (
            <Banner tone="success" onDismiss={() => setSent(false)}>
              <p>{t(locale, "composer.sent")}</p>
            </Banner>
          ) : null}
          {formError ? (
            <Banner tone="critical" onDismiss={() => setFormError(null)}>
              <p>{errorMessage(locale, formError)}</p>
            </Banner>
          ) : null}
          <TextField
            label={t(locale, "composer.label")}
            placeholder={t(locale, "composer.placeholder")}
            value={body}
            onChange={(value) => {
              setBody(value);
              if (fieldErrors.body) setFieldErrors((prev) => ({ ...prev, body: undefined }));
            }}
            multiline={4}
            maxLength={MAX_BODY_LENGTH}
            showCharacterCount
            autoComplete="off"
            error={fieldErrors.body ? errorMessage(locale, fieldErrors.body) : undefined}
            disabled={submitting}
          />
          <TextField
            label={t(locale, "composer.emailLabel")}
            helpText={t(locale, "composer.emailHelp")}
            type="email"
            value={email}
            onChange={(value) => {
              setEmail(value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            error={fieldErrors.email ? errorMessage(locale, fieldErrors.email) : undefined}
            disabled={submitting}
          />
          <InlineStack align="end">
            <Button variant="primary" submit loading={submitting}>
              {t(locale, "composer.send")}
            </Button>
          </InlineStack>
        </FormLayout>
      </form>
    </Card>
  );
}

/**
 * The `/app/messages` page. Reads `messagesRoute().loader` data. Renders `null`
 * when the kit is disabled (the app should not link here in that case).
 */
export function MessagesPage({ locale: localeProp, actionPath }: MessagesPageProps = {}) {
  const data = useLoaderData() as unknown as MessagesLoaderData | null | undefined;
  if (!data || !data.enabled) return null;
  const locale = localeProp ?? data.locale;

  if (data.unavailable) {
    return (
      <Page title={t(locale, "page.title")}>
        <Banner tone="warning">
          <p>{t(locale, "error.unavailable", { email: SUPPORT_EMAIL })}</p>
        </Banner>
      </Page>
    );
  }

  const setupPending = data.conversation?.kind === "setup" && data.conversation.status !== "closed";

  return (
    <Page title={t(locale, "page.title")}>
      <BlockStack gap="400">
        {setupPending ? (
          <Banner tone="info">
            <p>{t(locale, "setup.requestedBanner")}</p>
          </Banner>
        ) : null}
        <Card>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              {t(locale, "page.subtitle", { app: data.app })}
            </Text>
            <Thread messages={data.messages} locale={locale} />
          </BlockStack>
        </Card>
        <Composer locale={locale} defaultEmail={data.contact.email} actionPath={actionPath} />
      </BlockStack>
    </Page>
  );
}
