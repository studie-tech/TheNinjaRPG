import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { act, cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as native from "@/hooks/useNativeShell";
import { MetaTrackingConsent } from "@/layout/MetaTrackingConsent";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import * as pixel from "@/libs/metaPixel";
import { META_CONVERSION_EVENT, type readMetaTracking } from "@/libs/metaTracking";

type Input = NonNullable<ReturnType<typeof readMetaTracking>>;
type Result = { event: "register"; eventId: string }[];
let callbacks: {
  onMutate: () => { userId?: string };
  onSuccess: (events: Result, input: Input, context: { userId?: string }) => void;
};
let currentUser = "player";
const synchronize = vi.fn();
const confirmedConversion = vi.fn();
const decide = (granted: boolean) => {
  window.Cookiebot = { consent: { marketing: granted }, hasResponse: true };
  document.cookie = `tnr_consent=${encodeURIComponent(JSON.stringify({ consentId: "11f90b37-6015-4361-8c51-fbfcccb92b43", revision: CONSENT_REVISION, categories: granted ? ["necessary", "marketing"] : ["necessary"], consentTimestamp: new Date(Date.now() - 1000).toISOString() }))}; path=/`;
};
beforeEach(() => {
  currentUser = "player";
  synchronize.mockClear();
  confirmedConversion.mockClear();
  vi.spyOn(clerk, "useUser").mockImplementation(
    () => ({ isLoaded: true, isSignedIn: true, user: { id: currentUser } }) as never,
  );
  vi.spyOn(native, "useNativeShell").mockReturnValue(false);
  vi.spyOn(pixel, "getMetaPixelTracker").mockReturnValue({
    confirmedConversion,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    meta: {
      synchronizeConsent: {
        useMutation: (options: typeof callbacks) => {
          callbacks = options;
          return { mutate: synchronize };
        },
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Cookiebot;
  document.cookie = "tnr_consent=; Max-Age=0; path=/";
  localStorage.clear();
});

it("rechecks withdrawal before forwarding a delayed receipt and clears attribution immediately", () => {
  decide(true);
  render(<MetaTrackingConsent pixelId="12345" />);
  const input = synchronize.mock.calls[0]?.[0] as Input;
  const context = callbacks.onMutate();
  localStorage.setItem("tnr_meta_click", "private");
  decide(false);
  act(() => window.dispatchEvent(new window.Event("CookiebotOnDecline")));
  expect(localStorage.getItem("tnr_meta_click")).toBeNull();
  expect(synchronize.mock.calls.at(-1)?.[0].granted).toBe(false);
  callbacks.onSuccess(
    [{ event: "register", eventId: crypto.randomUUID() }],
    input,
    context,
  );
  expect(confirmedConversion).not.toHaveBeenCalled();
});

it("fetches server-confirmed receipts after a conversion and forwards their exact IDs", () => {
  decide(true);
  render(<MetaTrackingConsent pixelId="12345" />);
  act(() => window.dispatchEvent(new window.Event(META_CONVERSION_EVENT)));
  const input = synchronize.mock.calls.at(-1)?.[0] as Input;
  const id = crypto.randomUUID();
  callbacks.onSuccess(
    [{ event: "register", eventId: id }],
    input,
    callbacks.onMutate(),
  );
  expect(confirmedConversion).toHaveBeenCalledWith("register", id);
});

it("discards a former account's late response after the session changes", () => {
  decide(true);
  const view = render(<MetaTrackingConsent pixelId="12345" />);
  const input = synchronize.mock.calls[0]?.[0] as Input;
  const context = callbacks.onMutate();
  currentUser = "another-player";
  view.rerender(<MetaTrackingConsent pixelId="12345" />);
  callbacks.onSuccess(
    [{ event: "register", eventId: crypto.randomUUID() }],
    input,
    context,
  );
  expect(confirmedConversion).not.toHaveBeenCalled();
});
