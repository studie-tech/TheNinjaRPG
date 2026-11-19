import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as CookieConsent from "vanilla-cookieconsent";
import * as NativeShell from "@/hooks/useNativeShell";
import { CookieConsentManager } from "@/layout/CookieConsentManager";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Cookiebot;
  localStorage.clear();
});

it("signals other tabs and delivers consent when receipt storage exceeds quota", () => {
  vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(false);
  // Keep initialization pending so this test exercises only the registered choice callback.
  const initialize = vi
    .spyOn(CookieConsent, "run")
    .mockImplementation(() => new Promise(() => {}));
  const cookie = {
    categories: ["necessary"],
    revision: 2,
    data: null,
    consentId: "ba01a1bd-359b-4fc6-bfda-c58f54a65f79",
    consentTimestamp: "2026-11-19T00:00:00.000Z",
    lastConsentTimestamp: "2026-11-19T00:00:00.000Z",
    languageCode: "en",
    services: {},
    expirationTime: 0,
  };
  vi.spyOn(CookieConsent, "getCookie").mockReturnValue(cookie);
  const write = vi
    .spyOn(window.Storage.prototype, "setItem")
    .mockImplementation((key) => {
      if (key === "tnr-consent-receipt") {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
    });
  const deliver = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 503 }));

  render(<CookieConsentManager />);
  expect(initialize).toHaveBeenCalledTimes(1);
  initialize.mock.calls[0]?.[0]?.onFirstConsent?.({ cookie });

  expect(write).toHaveBeenCalledWith("tnr-consent-receipt", expect.any(String));
  expect(write).toHaveBeenCalledWith("tnr-consent-change", expect.any(String));
  expect(deliver).toHaveBeenCalledWith(
    "/api/consent-receipts",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining(cookie.consentId),
    }),
  );
});
