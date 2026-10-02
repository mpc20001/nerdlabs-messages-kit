import { vi } from "vitest";

export type FetchCall = { url: string; init: RequestInit };

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Install a fetch mock answering from `handler`; returns the recorded calls. */
export function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init: init ?? {} };
    calls.push(call);
    return handler(url, call.init);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

export const thread = {
  conversation: { id: "c1", kind: "message", status: "open" },
  messages: [
    { id: "m1", author: "merchant", body: "Hi there", createdAt: "2026-10-01T10:00:00.000Z" },
    { id: "m2", author: "admin", body: "Hello! How can I help?", createdAt: "2026-10-01T11:00:00.000Z" },
  ],
  unread: 1,
} as const;
