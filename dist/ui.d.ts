import * as react from 'react';
export { A as Author, C as Conversation, c as ConversationKind, d as ConversationStatus, e as Message, f as MessageKey, b as MessagesActionData, g as MessagesIntent, M as MessagesLoaderData, P as PostMessageInput, a as PostMessageResult, h as SUPPORTED_LOCALES, j as SUPPORT_EMAIL, S as ShopContact, i as SupportedLocale, T as Thread, k as TranslationVars, l as errorMessage, n as isMessageKey, m as messagesNavLabel, r as resolveLocale, t } from './index-vVc1LihO.js';

type MessagesPageProps = {
    /** Overrides the locale from loader data. */
    locale?: string;
    /** Where the composer posts. Defaults to the current route (the one exporting `messagesRoute().action`). */
    actionPath?: string;
};
/**
 * The `/app/messages` page. Reads `messagesRoute().loader` data. Renders `null`
 * when the kit is disabled (the app should not link here in that case).
 */
declare function MessagesPage({ locale: localeProp, actionPath }?: MessagesPageProps): react.JSX.Element | null;

type FreeSetupCardProps = {
    /** Pass the loader's `messagesEnabled: isMessagesEnabled()`. Renders nothing when false. */
    enabled: boolean;
    locale?: string | null;
    /** Route exporting `messagesRoute().action`. Default "/app/messages". */
    actionPath?: string;
    /** Link to the messages page shown after success. Default: `actionPath`. */
    messagesHref?: string;
    /** Reply-to email. Optional: the action falls back to the shop's contact email. */
    email?: string | null;
};
/** Dashboard card offering free done-for-you setup. Posts `intent=setup` to the messages action. */
declare function FreeSetupCard({ enabled, locale, actionPath, messagesHref, email: emailProp, }: FreeSetupCardProps): react.JSX.Element | null;

type HelpLineProps = {
    /** Pass the loader's `messagesEnabled: isMessagesEnabled()`. Renders nothing when false. */
    enabled: boolean;
    locale?: string | null;
    /** Default "/app/messages". */
    href?: string;
};
/** One subdued line + "Message us" link, for dashboards once setup is done. */
declare function HelpLine({ enabled, locale, href }: HelpLineProps): react.JSX.Element | null;

/**
 * Localized "time ago" for recent messages, absolute local date/time for older
 * ones. With `now === null` (SSR / pre-hydration) returns a deterministic UTC
 * absolute form instead.
 */
declare function formatMessageTime(iso: string, locale: string, now: number | null): string;

export { FreeSetupCard, type FreeSetupCardProps, HelpLine, type HelpLineProps, MessagesPage, type MessagesPageProps, formatMessageTime };
