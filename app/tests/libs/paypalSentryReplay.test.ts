import { afterAll, describe, expect, it, vi } from "bun:test";
import { BrowserClient, defaultStackParser, type Event, type EventHint } from "@sentry/browser";
import * as Sentry from "@sentry/nextjs";
// @ts-expect-error The client integration the Next.js SDK installs; it is neither exported nor typed.
import { nextjsClientStackFrameNormalizationIntegration } from "../../node_modules/@sentry/nextjs/build/esm/client/clientNormalizationIntegration.js";

/** The production filter, taken from the options `instrumentation-client.ts` initializes with. */
const init = vi.spyOn(Sentry, "init").mockImplementation((() => undefined) as never);
await import("../../instrumentation-client");
const { beforeSend } = init.mock.calls[0]![0] as unknown as {
  beforeSend: (event: Event, hint: EventHint) => Event | null;
};
afterAll(() => init.mockRestore());

const chromeStack = (name: string, message: string, url: string) =>
  `${name}: ${message}\n    at dispatch (${url}:2:1234)\n    at resolve (${url}:2:999)`;
const firefoxStack = (_name: string, _message: string, url: string) =>
  `dispatch@${url}:2:1234\nresolve@${url}:2:999`;

/** Send an error through the SDK's event pipeline and the production filter. */
const replay = async (name: string, message: string, stack: string) => {
  const error = Object.assign(new Error(message), { name, stack });
  let frames: (string | undefined)[] = [];
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
      frames =
        event.exception?.values?.[0]?.stacktrace?.frames?.map((frame) => frame.filename) ?? [];
      dropped = beforeSend(event, hint) === null;
      return null;
    },
  });
  client.init();
  client.captureException(error, { originalException: error });
  await client.flush(1000);
  return { frames, dropped };
};

const CLOSED = ["Error", "Connection closed"] as const;
const OVERFLOW = ["RangeError", "Maximum call stack size exceeded"] as const;

describe("PayPal Sentry filter", () => {
  it("sees frames with their origin already replaced", async () => {
    const { frames } = await replay(
      ...CLOSED,
      chromeStack(...CLOSED, "https://www.paypal.com/sdk/js?client-id=abc"),
    );
    expect(frames).toContain("app:///sdk/js?client-id=abc");
  });

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
      expect((await replay(name, message, stack(name, message, url))).dropped).toBe(true);
    }
  });

  it.each([
    ["look-alike host", "https://www.paypal.com.evil.example/sdk/js"],
    ["other SDK", "https://connect.example.com/sdk/js"],
    ["own chunk named after PayPal", "https://www.theninja-rpg.com/_next/static/chunks/paypal-1a2b.js"],
  ])("reports the same errors from a %s", async (_label, url) => {
    for (const [name, message] of [CLOSED, OVERFLOW]) {
      const replayed = await replay(name, message, chromeStack(name, message, url));
      expect(replayed.dropped).toBe(false);
    }
  });
});
