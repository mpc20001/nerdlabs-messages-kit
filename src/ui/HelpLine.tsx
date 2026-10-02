import { Button, InlineStack, Text } from "@shopify/polaris";
import { t } from "../i18n/index.js";

export type HelpLineProps = {
  /** Pass the loader's `messagesEnabled: isMessagesEnabled()`. Renders nothing when false. */
  enabled: boolean;
  locale?: string | null;
  /** Default "/app/messages". */
  href?: string;
};

/** One subdued line + "Message us" link, for dashboards once setup is done. */
export function HelpLine({ enabled, locale, href = "/app/messages" }: HelpLineProps) {
  if (!enabled) return null;
  return (
    <InlineStack gap="200" blockAlign="center" wrap>
      <Text as="span" tone="subdued">
        {t(locale, "helpLine.text")}
      </Text>
      <Button variant="plain" url={href}>
        {t(locale, "helpLine.button")}
      </Button>
    </InlineStack>
  );
}
