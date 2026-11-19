import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { consentConfig } from "@/libs/consentConfig";

type ConsentLibrary = {
  run: (config: typeof consentConfig) => Promise<void>;
  acceptCategory: (category: string) => void;
};
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: Record<string, unknown>,
  ) => {
    window: Pick<Window, "document" | "close"> & {
      eval: (source: string) => void;
      JSON: typeof JSON;
      RegExp: RegExpConstructor;
      CookieConsent: ConsentLibrary;
    };
  };
};

it("withdrawal clears host-only and parent-domain analytics and marketing cookies", async () => {
  const browser = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://www.theninja-rpg.com/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  try {
    const source = readFileSync(
      new URL("./cookieconsent.umd.js", import.meta.resolve("vanilla-cookieconsent")),
      "utf8",
    );
    browser.window.eval(source);
    const manager = browser.window.CookieConsent;
    // CookieConsent checks RegExp identity, so construct rules in its browser realm.
    const config = browser.window.JSON.parse(
      JSON.stringify({ ...consentConfig, autoShow: false }, (_key, value) =>
        value instanceof RegExp ? { pattern: value.source, flags: value.flags } : value,
      ),
      (_key: string, value: { pattern?: string; flags?: string } | null) =>
        value?.pattern ? new browser.window.RegExp(value.pattern, value.flags) : value,
    );
    await manager.run(config);
    manager.acceptCategory("all");
    for (const name of ["_ga", "_fbp"]) {
      browser.window.document.cookie = `${name}=parent; Domain=theninja-rpg.com; Path=/`;
      browser.window.document.cookie = `${name}_host=host; Path=/`;
    }
    expect(browser.window.document.cookie).toContain("_ga=parent");
    expect(browser.window.document.cookie).toContain("_fbp_host=host");
    manager.acceptCategory("necessary");
    expect(browser.window.document.cookie).not.toMatch(/(?:^|;\s*)_(?:ga|fb)/);
    expect(browser.window.document.cookie).toContain("tnr_consent=");
  } finally {
    browser.window.close();
  }
});
