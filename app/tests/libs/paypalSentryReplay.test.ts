import { afterAll, describe, expect, it, vi } from "bun:test";
import { BrowserClient, defaultStackParser, type Event, type EventHint } from "@sentry/browser";
import * as Sentry from "@sentry/nextjs";
// @ts-expect-error The client integration the Next.js SDK installs; it is neither exported nor typed.
import { nextjsClientStackFrameNormalizationIntegration } from "../../node_modules/@sentry/nextjs/build/esm/client/clientNormalizationIntegration.js";

/** The production filter, taken from the options `instrumentation-client.ts` initializes with. */
const init = vi.spyOn(Sentry, "init").mockImplementation((() => undefined) as never);
await import("../../instrumentation-client");
const { beforeSend, ignoreErrors } = init.mock.calls[0]![0] as unknown as {
  beforeSend: (event: Event, hint: EventHint) => Event | null;
  ignoreErrors: (string | RegExp)[];
};
afterAll(() => init.mockRestore());

const chromeStack = (name: string, message: string, url: string) =>
  `${name}: ${message}\n    at dispatch (${url}:2:1234)\n    at resolve (${url}:2:999)`;
const firefoxStack = (_name: string, _message: string, url: string) =>
  `dispatch@${url}:2:1234\nresolve@${url}:2:999`;

/** Send an error through the SDK's event pipeline and the production filter. */
const replay = async (name: string, message: string, stack: string) => {
  const error = Object.assign(new Error(message), { name, stack });
  let dropped: boolean | undefined;
  const client = new BrowserClient({
    dsn: "https://key@o1.ingest.sentry.io/1",
    transport: () => ({ send: async () => ({}), flush: async () => true }),
    stackParser: defaultStackParser,
    integrations: [
      nextjsClientStackFrameNormalizationIntegration({
        assetPrefix: undefined,
        basePath: undefined,
        rewriteFramesAssetPrefixPath: "",
        experimentalThirdPartyOriginStackFrames: false,
      }),
    ],
    beforeSend: (event, hint) => {
      dropped = beforeSend(event, hint) === null;
      return null;
    },
  });
  client.init();
  client.captureException(error, { originalException: error });
  await client.flush(1000);
  return dropped;
};

const CLOSED = ["Error", "Connection closed"] as const;
const OVERFLOW = ["RangeError", "Maximum call stack size exceeded"] as const;

describe("third-party script Sentry filters", () => {
  const ILLEGAL = ["TypeError", "Illegal invocation"] as const;
  const NULL_DOM = ["TypeError", "Cannot set properties of null (setting 'innerHTML')"] as const;
  const CLONE = ["DataCloneError", "Failed to execute 'postMessage' on 'Window': An object could not be cloned."] as const;
  const dropped = async ([name, message]: readonly [string, string], stack: typeof chromeStack, url: string) =>
    await replay(name, message, stack(name, message, url));
  const own = "https://www.theninja-rpg.com/_next/static/chunks";

  it("leaves Illegal invocation to the host check, which ignoreErrors would pre-empt", () => {
    expect(ignoreErrors).not.toContain("Illegal invocation");
  });

  it.each([
    ["Illegal invocation", ILLEGAL, "https://consent.cookiebot.com/uc.js?cbid=abc"],
    ["a banner on a missing element", NULL_DOM, "https://consentcdn.cookiebot.com/sdk/bc-v4.min.cc.js"],
    ["a Google tag clone failure", CLONE, "https://www.googletagmanager.com/gtag/js?id=G-ABC"],
  ])("drops %s raised by the vendor's host", async (_label, error, url) => {
    for (const stack of [chromeStack, firefoxStack]) expect(await dropped(error, stack, url)).toBe(true);
  });

  it.each([
    ["Illegal invocation", ILLEGAL, "https://www.theninja-rpg.com/inject_content.js"],
    ["Illegal invocation", ILLEGAL, "https://www.theninja-rpg.com/inject_content.js?v=2"],
    ["a clone failure", CLONE, "https://www.theninja-rpg.com/mediafilter.js"],
    ["a clone failure", CLONE, "https://www.theninja-rpg.com/assets/mediafilter"],
  ])("drops %s from an injected script without a host: %s", async (_label, error, url) => {
    for (const stack of [chromeStack, firefoxStack]) expect(await dropped(error, stack, url)).toBe(true);
  });

  it.each([
    ["own chunk ending in cc.js", ILLEGAL, `${own}/acc.js`],
    ["own chunk ending in cc.js", NULL_DOM, `${own}/acc.js`],
    ["own chunk ending in uc.js", ILLEGAL, `${own}/menuc.js`],
    ["own chunk ending like the injected script", ILLEGAL, `${own}/reinject_content.js`],
    ["own chunk named after the injected script", ILLEGAL, `${own}/inject_content.js.map.js`],
    ["own chunk named after gtag", CLONE, `${own}/gtag/js`],
    ["Google Tag Manager's own script", CLONE, "https://www.googletagmanager.com/gtm.js?id=GTM-ABC"],
    ["own chunk containing mediafilter", CLONE, `${own}/mediafilter-1a2b.js`],
    ["own chunk ending in mediafilter", CLONE, `${own}/socialmediafilter.js`],
    ["Cookiebot look-alike host", ILLEGAL, "https://consent.cookiebot.com.evil.example/uc.js"],
    ["Cookiebot look-alike host", NULL_DOM, "https://evilcookiebot.com/cc.js"],
    ["Google tag look-alike host", CLONE, "https://www.googletagmanager.com.evil.example/gtag/js"],
  ])("reports an error from: %s", async (_label, error, url) => {
    for (const stack of [chromeStack, firefoxStack]) expect(await dropped(error, stack, url)).toBe(false);
  });

  it.each([
    ["Illegal invocation", ["TypeError", "Something else"], "https://consent.cookiebot.com/uc.js"],
    ["DataCloneError", ["Error", "Something else"], "https://www.googletagmanager.com/gtag/js"],
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
    ["own chunk named after PayPal", "https://www.theninja-rpg.com/_next/static/chunks/paypal-1a2b.js"],
  ])("reports the same errors from a %s", async (_label, url) => {
    for (const [name, message] of [CLOSED, OVERFLOW]) {
      const replayed = await replay(name, message, chromeStack(name, message, url));
      expect(replayed).toBe(false);
    }
  });
});
