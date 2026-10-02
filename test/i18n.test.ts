import { describe, expect, it } from "vitest";
import { DICTIONARIES, messagesNavLabel, resolveLocale, SUPPORTED_LOCALES, t } from "../src/i18n/index.js";
import { en } from "../src/i18n/en.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it("covers exactly the 21 required locales", () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(
      ["en", "cs", "da", "de", "es", "fi", "fr", "it", "ja", "ko", "nb", "nl", "pl", "pt-BR", "pt-PT", "sv", "th", "tr", "vi", "zh-CN", "zh-TW"].sort(),
    );
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  const enKeys = Object.keys(en).sort();
  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: same keys and placeholders as en, non-empty, brand untranslated`, () => {
      const dict = DICTIONARIES[locale];
      expect(Object.keys(dict).sort()).toEqual(enKeys);
      for (const key of enKeys) {
        const value = dict[key as keyof typeof en];
        const source = en[key as keyof typeof en];
        expect(value.trim(), `${locale} ${key}`).not.toBe("");
        expect(placeholders(value), `${locale} ${key}`).toEqual(placeholders(source));
        if (source.includes("Nerd Labs")) expect(value, `${locale} ${key}`).toContain("Nerd Labs");
      }
    });
  }
});

describe("resolveLocale", () => {
  it.each([
    ["en", "en"],
    ["de", "de"],
    ["de-AT", "de"],
    ["pt-BR", "pt-BR"],
    ["pt_pt", "pt-PT"],
    ["pt", "pt-BR"],
    ["zh", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh-Hant-HK", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-Hans", "zh-CN"],
    ["no", "nb"],
    ["nb-NO", "nb"],
    ["EN-us", "en"],
    ["xx", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ])("%s → %s", (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });
});

describe("t", () => {
  it("substitutes vars literally and falls back to en", () => {
    expect(t("de", "error.bodyTooLong", { max: 5000 })).toBe("Nachrichten dürfen höchstens 5000 Zeichen lang sein.");
    expect(t("xx", "nav.messages")).toBe("Messages");
    expect(t("en", "page.subtitle", { app: "$& $1 Q" })).toContain("Questions about $& $1 Q?");
    expect(t("en", "error.unavailable")).toContain("{email}");
  });
});

describe("messagesNavLabel", () => {
  it("adds the count only when > 0", () => {
    expect(messagesNavLabel("en", 0)).toBe("Messages");
    expect(messagesNavLabel("en", null)).toBe("Messages");
    expect(messagesNavLabel("en", 2)).toBe("Messages (2)");
    expect(messagesNavLabel("ja", 3)).toBe("メッセージ (3)");
  });
});
