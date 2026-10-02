import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, InlineStack, Text, TextField } from "@shopify/polaris";
import {
  errorMessage,
  isMessageKey,
  MAX_EMAIL_LENGTH,
  MAX_NOTE_LENGTH,
  resolveLocale,
  t,
  type MessageKey,
} from "../i18n/index.js";
import type { MessagesActionData } from "../types.js";

export type FreeSetupCardProps = {
  /** Pass the loader's `messagesEnabled: isMessagesEnabled()`. Renders nothing when false. */
  enabled: boolean;
  locale?: string | null;
  /** Route exporting `messagesRoute().action`. Default "/app/messages". */
  actionPath?: string;
  /** Link to the messages page shown after success. Default: `actionPath`. */
  messagesHref?: string;
  /** Reply-to email. Optional: the action falls back to the shop's contact email. */
  email?: string | null;
  /**
   * The shop already has an open setup request (from `threadSummaryForShop(shop)?.setupOpen`).
   * Renders the "Requested!" state instead of the form.
   */
  alreadyRequested?: boolean;
};

/** Dashboard card offering free done-for-you setup. Posts `intent=setup` to the messages action. */
export function FreeSetupCard({
  enabled,
  locale: localeProp,
  actionPath = "/app/messages",
  messagesHref,
  email: emailProp,
  alreadyRequested = false,
}: FreeSetupCardProps) {
  const locale = resolveLocale(localeProp);
  const fetcher = useFetcher<MessagesActionData>();
  const [note, setNote] = useState("");
  const [email, setEmail] = useState(emailProp ?? "");
  // The email field only appears if the shop has no usable contact email.
  const [needsEmail, setNeedsEmail] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [requested, setRequested] = useState(false);
  const submitting = fetcher.state !== "idle";
  const data = fetcher.data as MessagesActionData | undefined;

  useEffect(() => {
    if (fetcher.state !== "idle" || !data) return;
    if (data.ok) {
      if (data.intent === "setup") setRequested(true);
      return;
    }
    const key: MessageKey = isMessageKey(data.error) ? data.error : "error.generic";
    if (key === "error.emailRequired" || key === "error.emailInvalid") setNeedsEmail(true);
    setError(key);
  }, [data, fetcher.state]);

  if (!enabled) return null;

  const href = messagesHref ?? actionPath;

  if (requested || alreadyRequested) {
    return (
      <Card>
        <BlockStack gap="300">
          <Banner tone="success">
            <p>{t(locale, "setupCard.success")}</p>
          </Banner>
          <InlineStack>
            <Button url={href}>{t(locale, "setupCard.viewMessages")}</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
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
      { intent: "setup", body: trimmedNote, merchantEmail: email.trim(), locale },
      { method: "post", action: actionPath },
    );
  };

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t(locale, "setupCard.title")}
          </Text>
          <Text as="p">{t(locale, "setupCard.body")}</Text>
          {formError ? (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{errorMessage(locale, formError)}</p>
            </Banner>
          ) : null}
          <TextField
            label={t(locale, "setupCard.noteLabel")}
            value={note}
            onChange={(value) => {
              setNote(value);
              if (noteError) setError(null);
            }}
            multiline={3}
            maxLength={MAX_NOTE_LENGTH}
            showCharacterCount
            autoComplete="off"
            error={noteError ? errorMessage(locale, noteError) : undefined}
            disabled={submitting}
          />
          {needsEmail ? (
            <TextField
              label={t(locale, "composer.emailLabel")}
              type="email"
              value={email}
              onChange={(value) => {
                setEmail(value);
                if (emailError) setError(null);
              }}
              maxLength={MAX_EMAIL_LENGTH}
              autoComplete="email"
              error={emailError ? errorMessage(locale, emailError) : undefined}
              disabled={submitting}
            />
          ) : null}
          <InlineStack>
            <Button variant="primary" submit loading={submitting}>
              {t(locale, "setupCard.button")}
            </Button>
          </InlineStack>
        </BlockStack>
      </form>
    </Card>
  );
}
