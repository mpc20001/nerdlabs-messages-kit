/**
 * English source dictionary. Every other locale must provide exactly these keys
 * with exactly the same `{placeholder}` set (enforced by test/i18n.test.ts and,
 * for keys, by the `Dictionary` type).
 *
 * "Nerd Labs" is a brand name and stays untranslated everywhere.
 */
export const en = {
  "nav.messages": "Messages",
  "nav.messagesWithCount": "Messages ({count})",

  "page.title": "Messages",
  "page.subtitle":
    "Questions about {app}? Message the Nerd Labs team — we reply here and by email, usually within a few hours.",
  "page.empty": "No messages yet. Ask us anything — a real person reads every message.",

  "author.you": "You",
  "author.admin": "Joren from Nerd Labs",
  "author.system": "Nerd Labs",

  "composer.label": "Your message",
  "composer.placeholder": "How can we help?",
  "composer.emailLabel": "Reply-to email",
  "composer.emailHelp": "We'll also send our reply to this address.",
  "composer.send": "Send",
  "composer.sent": "Message sent. We'll reply here and by email.",

  "setup.requestedBanner": "Free setup requested — we'll reach out within 1 business day",

  "setupCard.title": "Want us to set it up for you? It's free.",
  "setupCard.body":
    "Tell us what you want it to do and we'll configure the app in your store for you — usually within 1 business day.",
  "setupCard.noteLabel": "What should the app do? (optional)",
  "setupCard.button": "Set it up for me",
  "setupCard.success": "Requested! We'll email you within 1 business day.",
  "setupCard.viewMessages": "View messages",

  "helpLine.text": "Need a hand? We'll set it up for you for free.",
  "helpLine.button": "Message us",

  "error.bodyRequired": "Please write a message first.",
  "error.bodyTooLong": "Messages can be up to {max} characters.",
  "error.noteTooLong": "The note can be up to {max} characters.",
  "error.emailRequired": "Please add an email address so we can reply.",
  "error.emailInvalid": "Please enter a valid email address.",
  "error.rateLimited": "You've sent a lot of messages in the last hour. Please try again a bit later.",
  "error.unavailable": "Messages are unavailable right now — email {email}",
  "error.generic": "Something went wrong. Please try again or email {email}.",
};

export type MessageKey = keyof typeof en;
export type Dictionary = Readonly<Record<MessageKey, string>>;
