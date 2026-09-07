import { describe, expect, it } from "vitest";
import { dictionaries } from "./i18n";

const componentSources = import.meta.glob("./*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("translation dictionaries", () => {
  it.each(["uz", "ru"] as const)(
    "%s covers every English translation key",
    (locale) => {
      const missing = Object.keys(dictionaries.en).filter(
        (key) => !dictionaries[locale][key]?.trim(),
      );
      expect(missing).toEqual([]);
    },
  );

  it("defines every static translation key used by a component", () => {
    const used = Object.values(componentSources).flatMap((source) =>
      [...source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)].map((match) => match[1]),
    );
    const missing = [...new Set(used)].filter((key) => !dictionaries.en[key]);
    expect(missing).toEqual([]);
  });
});
