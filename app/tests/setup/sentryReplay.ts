import { vi } from "bun:test";
import {
  BrowserClient,
  defaultStackParser,
  type Event,
  type EventHint,
} from "@sentry/browser";
import * as Sentry from "@sentry/nextjs";
// @ts-expect-error The client integration the Next.js SDK installs; it is neither exported nor typed.
import { nextjsClientStackFrameNormalizationIntegration } from "../../node_modules/@sentry/nextjs/build/esm/client/clientNormalizationIntegration.js";

/**
 * The production filter, taken from the options `instrumentation-client.ts` initializes with.
 * The module runs once per process, so every replay suite reads the options from here.
 */
const init = vi.spyOn(Sentry, "init").mockImplementation((() => undefined) as never);
await import("../../instrumentation-client");
export const { beforeSend, ignoreErrors } = init.mock.calls[0]![0] as unknown as {
  beforeSend: (event: Event, hint: EventHint) => Event | null;
  ignoreErrors: (string | RegExp)[];
};
init.mockRestore();

/** Build a Chrome-shaped error stack for exercising the application's Sentry filter. */
export const chromeStack = (name: string, message: string, url: string) =>
  `${name}: ${message}\n    at dispatch (${url}:2:1234)\n    at resolve (${url}:2:999)`;
/** Build a Firefox-shaped error stack for the same application filter scenarios. */
export const firefoxStack = (_name: string, _message: string, url: string) =>
  `dispatch@${url}:2:1234\nresolve@${url}:2:999`;

/** Send any thrown value through the SDK's event pipeline and the production filter. */
export const replayException = async (exception: unknown) => {
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
  client.captureException(exception, { originalException: exception });
  await client.flush(1000);
  return dropped;
};

/** Send an error through the SDK's event pipeline and the production filter. */
export const replay = (name: string, message: string, stack: string) =>
  replayException(Object.assign(new Error(message), { name, stack }));
