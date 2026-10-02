import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { createRemixStub } from "@remix-run/testing";
import { AppProvider } from "@shopify/polaris";
import enPolaris from "@shopify/polaris/locales/en.json";
import { FreeSetupCard, HelpLine, MessagesPage, messagesNavLabel } from "../src/ui/index.js";
import type { MessagesLoaderData } from "../src/types.js";
import { thread } from "./helpers.js";

// react-router's RouterProvider (test harness only) uses useLayoutEffect, which
// React warns about under SSR. Any OTHER console.error (bad props, missing keys,
// hydration-unsafe code in the kit) fails the test.
let consoleErrors: string[] = [];
beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = args.map(String).join(" ");
    if (!message.includes("useLayoutEffect does nothing on the server")) consoleErrors.push(message);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(consoleErrors).toEqual([]);
});

/** SSR-render `element` as the route component at /app/messages with the given loader data. */
function renderRoute(element: () => ReactElement, loaderData: MessagesLoaderData | null = null): string {
  const Stub = createRemixStub([
    { id: "messages", path: "/app/messages", Component: element, loader: () => loaderData, action: () => null },
  ]);
  return renderToString(
    <AppProvider i18n={enPolaris}>
      <Stub initialEntries={["/app/messages"]} hydrationData={{ loaderData: { messages: loaderData } }} />
    </AppProvider>,
  );
}

const enabledData = (overrides: Partial<Extract<MessagesLoaderData, { app: string }>> = {}): MessagesLoaderData => ({
  enabled: true,
  conversation: { ...thread.conversation },
  messages: thread.messages.map((m) => ({ ...m })),
  unread: 1,
  contact: { email: "owner@shop.test", name: "Ann" },
  locale: "en",
  app: "QuickFiles",
  ...overrides,
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("<MessagesPage />", () => {
  it("renders nothing when disabled", () => {
    const html = renderRoute(() => <MessagesPage />, { enabled: false });
    expect(text(html).trim()).toBe("");
  });

  it("renders the thread with author labels, bubbles, composer and prefilled email", () => {
    const html = renderRoute(() => <MessagesPage />, enabledData());
    const plain = text(html);
    expect(plain).toContain("Messages");
    expect(plain).toContain("Questions about QuickFiles?");
    expect(plain).toContain("Hi there");
    expect(plain).toContain("Hello! How can I help?");
    expect(plain).toContain("You");
    expect(plain).toContain("Joren from Nerd Labs");
    expect(html).toContain('data-author="merchant"');
    expect(html).toContain('dateTime="2026-10-01T10:00:00.000Z"');
    // SSR renders a deterministic UTC timestamp (no clock/time-zone dependent output).
    expect(plain).toMatch(/Oct 1, 2026/);
    expect(plain).toContain("Reply-to email");
    expect(html).toContain('value="owner@shop.test"');
    expect(plain).toContain("Send");
    expect(plain).not.toContain("Free setup requested");
  });

  it("escapes message bodies", () => {
    const html = renderRoute(
      () => <MessagesPage />,
      enabledData({ messages: [{ id: "x", author: "admin", body: "<img src=x onerror=alert(1)>", createdAt: "2026-10-01T10:00:00Z" }] }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("shows the setup banner for an open setup conversation, not a closed one", () => {
    const open = renderRoute(() => <MessagesPage />, enabledData({ conversation: { id: "c", kind: "setup", status: "setup_in_progress" } }));
    expect(text(open)).toContain("Free setup requested — we'll reach out within 1 business day");
    const closed = renderRoute(() => <MessagesPage />, enabledData({ conversation: { id: "c", kind: "setup", status: "closed" } }));
    expect(text(closed)).not.toContain("Free setup requested");
  });

  it("renders the empty state and localizes via loader locale or prop", () => {
    const de = renderRoute(() => <MessagesPage />, enabledData({ messages: [], conversation: null, locale: "de" }));
    expect(text(de)).toContain("Noch keine Nachrichten");
    expect(text(de)).toContain("Antwort-E-Mail");
    const ja = renderRoute(() => <MessagesPage locale="ja" />, enabledData({ locale: "de" }));
    expect(text(ja)).toContain("Nerd Labs の Joren");
  });

  it("renders the unavailable state", () => {
    const html = renderRoute(() => <MessagesPage />, { enabled: true, unavailable: true, locale: "en" });
    expect(text(html)).toContain("Messages are unavailable right now — email support@nerdlabs.us");
    expect(text(html)).not.toContain("Reply-to email");
  });
});

describe("<FreeSetupCard />", () => {
  it("renders null when disabled", () => {
    expect(text(renderRoute(() => <FreeSetupCard enabled={false} />)).trim()).toBe("");
  });

  it("renders the localized card", () => {
    const en = text(renderRoute(() => <FreeSetupCard enabled locale="en" />));
    expect(en).toContain("Want us to set it up for you? It's free.");
    expect(en).toContain("Tell us what you want it to do");
    expect(en).toContain("Set it up for me");
    expect(en).toContain("What should the app do? (optional)");
    const fr = text(renderRoute(() => <FreeSetupCard enabled locale="fr-FR" />));
    expect(fr).toContain("Configurez-la pour moi");
  });
});

describe("<FreeSetupCard alreadyRequested />", () => {
  it("renders the requested state with a Messages link instead of the form", () => {
    const html = renderRoute(() => <FreeSetupCard enabled alreadyRequested locale="en" messagesHref="/app/messages" />);
    const plain = text(html);
    expect(plain).toContain("Requested! We'll email you within 1 business day.");
    expect(plain).toContain("View messages");
    expect(html).toContain('href="/app/messages"');
    expect(plain).not.toContain("Set it up for me");
  });

  it("still renders null when disabled", () => {
    expect(text(renderRoute(() => <FreeSetupCard enabled={false} alreadyRequested />)).trim()).toBe("");
  });
});

describe("<HelpLine />", () => {
  it("renders null when disabled, a link when enabled", () => {
    expect(text(renderRoute(() => <HelpLine enabled={false} />)).trim()).toBe("");
    const html = renderRoute(() => <HelpLine enabled locale="es" href="/app/messages" />);
    expect(text(html)).toContain("¿Necesitas ayuda?");
    expect(text(html)).toContain("Escríbenos");
    expect(html).toContain('href="/app/messages"');
  });
});

describe("messagesNavLabel (ui export)", () => {
  it("works from the ui entry", () => {
    expect(messagesNavLabel("de", 2)).toBe("Nachrichten (2)");
  });
});
