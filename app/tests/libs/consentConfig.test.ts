import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { CONSENT_BOOTSTRAP, consentConfig } from "@/libs/consentConfig";

describe("consent bootstrap", () => {
  it("denies optional storage before tags", () => {
    const browser: { dataLayer: Array<ArrayLike<unknown>>; gtag?: unknown } = {
      dataLayer: [],
    };
    runInNewContext(CONSENT_BOOTSTRAP, {
      window: browser,
      URL,
      location: { href: "https://www.theninja-rpg.com/login" },
    });
    const commands = browser.dataLayer;
    expect(commands[0]?.[0]).toBe("consent");
    expect(commands[0]?.[2]).toMatchObject({
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      security_storage: "granted",
    });
    expect(commands).toHaveLength(1);
  });
  it("uses opt-in categories, a revision and equally weighted accept/reject controls", () => {
    expect(consentConfig.mode).toBe("opt-in");
    expect(consentConfig.revision).toBeGreaterThan(0);
    expect(consentConfig.guiOptions?.consentModal?.equalWeightButtons).toBe(true);
    expect(consentConfig.categories?.statistics?.enabled).not.toBe(true);
    expect(consentConfig.categories?.marketing?.enabled).not.toBe(true);
  });
  it("discloses Meta browser and server reporting and clears both Meta matching cookies", () => {
    const disclosure = JSON.stringify(consentConfig.language.translations);
    expect(disclosure).toContain("Meta Pixel");
    expect(disclosure).toContain("server-side Meta Conversions API");
    expect(disclosure).toContain("Withdrawing marketing consent");
    const cookies = consentConfig.categories?.marketing?.autoClear?.cookies ?? [];
    for (const name of ["_fbp", "_fbc"]) {
      expect(
        cookies.some(
          (cookie) => cookie.name instanceof RegExp && cookie.name.test(name),
        ),
      ).toBe(true);
    }
  });
});
