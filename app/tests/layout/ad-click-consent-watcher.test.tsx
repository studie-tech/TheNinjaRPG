import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { act, cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { AdClickConsentWatcher } from "@/layout/AdClickConsentWatcher";
import {
  markAdClickLinked,
  readStoredAdClick,
  storeAdClick,
} from "@/libs/campaignSource";

const withdraw = vi.fn(
  (_input: { clickId?: string }, options?: { onSuccess?: (result: object) => void }) =>
    options?.onSuccess?.({ success: true, message: "Ad click forgotten" }),
);
let session: { isLoaded: boolean; isSignedIn: boolean; user?: { id: string } };

beforeEach(() => {
  withdraw.mockClear();
  window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
  vi.spyOn(clerk, "useUser").mockImplementation(() => session as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    misc: { withdrawAdClickConsent: { useMutation: () => ({ mutate: withdraw }) } },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Cookiebot;
  window.localStorage.clear();
});

it("withdraws the device click, then the account's click after signing in", () => {
  storeAdClick("Cj0KCQiA-device-click");
  session = { isLoaded: true, isSignedIn: false };
  const view = render(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(1);
  expect(withdraw.mock.calls[0]?.[0]).toEqual({ clickId: "Cj0KCQiA-device-click" });
  expect(readStoredAdClick()).toBeUndefined();

  // Signing in on the same page load gets its own attempt for the linked click.
  session = { isLoaded: true, isSignedIn: true, user: { id: "player-after-sign-in" } };
  view.rerender(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(2);
  expect(withdraw.mock.calls[1]?.[0]).toEqual({ clickId: undefined });

  // Each identity is attempted once per page load.
  view.rerender(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(2);
});

it("leaves the click alone while marketing consent is granted", () => {
  window.Cookiebot = { consent: { marketing: true }, hasResponse: true };
  storeAdClick("Cj0KCQiA-kept-click");
  session = { isLoaded: true, isSignedIn: true, user: { id: "consenting-player" } };
  render(<AdClickConsentWatcher />);
  expect(withdraw).not.toHaveBeenCalled();
  expect(readStoredAdClick()).toBe("Cj0KCQiA-kept-click");
});

it("withdraws again after consent is granted and declined once more", () => {
  storeAdClick("Cj0KCQiA-first-click");
  session = { isLoaded: true, isSignedIn: true, user: { id: "player-changing-mind" } };
  const view = render(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(1);

  window.Cookiebot = { consent: { marketing: true }, hasResponse: true };
  act(() => {
    window.dispatchEvent(new window.Event("CookiebotOnAccept"));
  });
  view.rerender(<AdClickConsentWatcher />);
  // The landing page reports the click again under the new consent.
  storeAdClick("Cj0KCQiA-first-click");

  window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
  act(() => {
    window.dispatchEvent(new window.Event("CookiebotOnDecline"));
  });
  view.rerender(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(2);
  expect(withdraw.mock.calls[1]?.[0]).toEqual({ clickId: "Cj0KCQiA-first-click" });
});

it("withdraws a click linked after an earlier withdrawal, even after a signed-out decline", () => {
  session = { isLoaded: true, isSignedIn: true, user: { id: "player-relinking" } };
  const view = render(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(1);

  // Consent is granted again and a registration on this device links a new click.
  window.Cookiebot = { consent: { marketing: true }, hasResponse: true };
  act(() => {
    window.dispatchEvent(new window.Event("CookiebotOnAccept"));
  });
  view.rerender(<AdClickConsentWatcher />);
  markAdClickLinked();

  // Signed out, another ad landing stores a click and the visitor declines.
  session = { isLoaded: true, isSignedIn: false };
  storeAdClick("Cj0KCQiA-signed-out-click");
  window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
  act(() => {
    window.dispatchEvent(new window.Event("CookiebotOnDecline"));
  });
  view.rerender(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(2);
  expect(withdraw.mock.calls[1]?.[0]).toEqual({ clickId: "Cj0KCQiA-signed-out-click" });

  // Signing back in still withdraws the account's linked click.
  session = { isLoaded: true, isSignedIn: true, user: { id: "player-relinking" } };
  view.rerender(<AdClickConsentWatcher />);
  expect(withdraw).toHaveBeenCalledTimes(3);
  expect(withdraw.mock.calls[2]?.[0]).toEqual({ clickId: undefined });
});
