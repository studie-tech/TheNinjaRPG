import { describe, expect, it } from "bun:test";
import { chromeStack, firefoxStack, ignoreErrors, replay } from "../setup/sentryReplay";

const CLOSED = ["Error", "Connection closed"] as const;
const OVERFLOW = ["RangeError", "Maximum call stack size exceeded"] as const;

describe("third-party script Sentry filters", () => {
  const ILLEGAL = ["TypeError", "Illegal invocation"] as const;
  const NULL_DOM = [
    "TypeError",
    "Cannot set properties of null (setting 'innerHTML')",
  ] as const;
  const CLONE = [
    "DataCloneError",
    "Failed to execute 'postMessage' on 'Window': An object could not be cloned.",
  ] as const;
  const dropped = async (
    [name, message]: readonly [string, string],
    stack: typeof chromeStack,
    url: string,
  ) => await replay(name, message, stack(name, message, url));
  const own = "https://www.theninja-rpg.com/_next/static/chunks";

  it("leaves Illegal invocation to the host check, which ignoreErrors would pre-empt", () => {
    expect(ignoreErrors).not.toContain("Illegal invocation");
  });

  it.each([
    ["Illegal invocation", ILLEGAL, "https://consent.cookiebot.com/uc.js?cbid=abc"],
    [
      "a banner on a missing element",
      NULL_DOM,
      "https://consentcdn.cookiebot.com/sdk/bc-v4.min.cc.js",
    ],
    [
      "a Google tag clone failure",
      CLONE,
      "https://www.googletagmanager.com/gtag/js?id=G-ABC",
    ],
  ])("drops %s raised by the vendor's host", async (_label, error, url) => {
    for (const stack of [chromeStack, firefoxStack])
      expect(await dropped(error, stack, url)).toBe(true);
  });

  it.each([
    ["Illegal invocation", ILLEGAL, "https://www.theninja-rpg.com/inject_content.js"],
    [
      "Illegal invocation",
      ILLEGAL,
      "https://www.theninja-rpg.com/inject_content.js?v=2",
    ],
    ["a clone failure", CLONE, "https://www.theninja-rpg.com/mediafilter.js"],
    ["a clone failure", CLONE, "https://www.theninja-rpg.com/assets/mediafilter"],
  ])(
    "drops %s from an injected script without a host: %s",
    async (_label, error, url) => {
      for (const stack of [chromeStack, firefoxStack])
        expect(await dropped(error, stack, url)).toBe(true);
    },
  );

  it.each([
    ["own chunk ending in cc.js", ILLEGAL, `${own}/acc.js`],
    ["own chunk ending in cc.js", NULL_DOM, `${own}/acc.js`],
    ["own chunk ending in uc.js", ILLEGAL, `${own}/menuc.js`],
    [
      "own chunk ending like the injected script",
      ILLEGAL,
      `${own}/reinject_content.js`,
    ],
    [
      "own chunk named after the injected script",
      ILLEGAL,
      `${own}/inject_content.js.map.js`,
    ],
    ["own chunk named after gtag", CLONE, `${own}/gtag/js`],
    [
      "Google Tag Manager's own script",
      CLONE,
      "https://www.googletagmanager.com/gtm.js?id=GTM-ABC",
    ],
    ["own chunk containing mediafilter", CLONE, `${own}/mediafilter-1a2b.js`],
    ["own chunk ending in mediafilter", CLONE, `${own}/socialmediafilter.js`],
    [
      "Cookiebot look-alike host",
      ILLEGAL,
      "https://consent.cookiebot.com.evil.example/uc.js",
    ],
    ["Cookiebot look-alike host", NULL_DOM, "https://evilcookiebot.com/cc.js"],
    [
      "Google tag look-alike host",
      CLONE,
      "https://www.googletagmanager.com.evil.example/gtag/js",
    ],
  ])("reports an error from: %s", async (_label, error, url) => {
    for (const stack of [chromeStack, firefoxStack])
      expect(await dropped(error, stack, url)).toBe(false);
  });

  it.each([
    [
      "Illegal invocation",
      ["TypeError", "Something else"],
      "https://consent.cookiebot.com/uc.js",
    ],
    [
      "DataCloneError",
      ["Error", "Something else"],
      "https://www.googletagmanager.com/gtag/js",
    ],
  ] as const)("reports a vendor error that is not %s", async (_label, error, url) => {
    expect(await dropped(error, chromeStack, url)).toBe(false);
  });
});

describe("PayPal Sentry filter", () => {
  it.each([
    ["closed", chromeStack, CLOSED],
    ["closed", firefoxStack, CLOSED],
    ["stack overflow", chromeStack, OVERFLOW],
    ["stack overflow", firefoxStack, OVERFLOW],
  ])("drops a PayPal SDK %s error", async (_label, stack, [name, message]) => {
    for (const url of [
      "https://www.paypal.com/sdk/js?client-id=abc",
      "https://www.sandbox.paypal.com/sdk/js?client-id=abc",
    ]) {
      expect(await replay(name, message, stack(name, message, url))).toBe(true);
    }
  });

  it.each([
    ["look-alike host", "https://www.paypal.com.evil.example/sdk/js"],
    ["other SDK", "https://connect.example.com/sdk/js"],
    [
      "own chunk named after PayPal",
      "https://www.theninja-rpg.com/_next/static/chunks/paypal-1a2b.js",
    ],
  ])("reports the same errors from a %s", async (_label, url) => {
    for (const [name, message] of [CLOSED, OVERFLOW]) {
      const replayed = await replay(name, message, chromeStack(name, message, url));
      expect(replayed).toBe(false);
    }
  });
});
