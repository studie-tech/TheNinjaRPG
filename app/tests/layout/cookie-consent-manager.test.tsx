import { afterEach, expect, it, vi } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import * as NativeShell from "@/hooks/useNativeShell";
import { CookieConsentManager } from "@/layout/CookieConsentManager";

const broadcastDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "BroadcastChannel",
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Cookiebot;
  localStorage.clear();
  if (broadcastDescriptor)
    Object.defineProperty(globalThis, "BroadcastChannel", broadcastDescriptor);
  else Reflect.deleteProperty(globalThis, "BroadcastChannel");
});

it("synchronizes saved consent once and signals changes when receipt storage exceeds quota", async () => {
  vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(false);
  const channel = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
  };
  const broadcast = vi.fn(() => channel);
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: broadcast,
  });
  const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
  let finishInitialization: () => void = () => {};
  const initialize = vi.spyOn(CookieConsent, "run").mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishInitialization = resolve;
      }),
  );
  vi.spyOn(CookieConsent, "validConsent").mockReturnValue(true);
  vi.spyOn(CookieConsent, "acceptedCategory").mockReturnValue(false);
  const signal = vi.spyOn(window, "dispatchEvent").mockReturnValue(true);
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

  render(
    <StrictMode>
      <CookieConsentManager />
    </StrictMode>,
  );
  await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  // Saved choices invoke onConsent before the manager's initialization resolves.
  await act(async () => {
    initialize.mock.calls[0]?.[0]?.onConsent?.({ cookie });
    finishInitialization();
  });
  expect(
    signal.mock.calls.filter(([event]) => event.type === "CookiebotOnConsentReady"),
  ).toHaveLength(1);
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
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect(channel.postMessage).not.toHaveBeenCalled();

  write.mockImplementation(() => {
    throw new DOMException("Storage quota exceeded", "QuotaExceededError");
  });
  // The local withdrawal reload is delayed; peers must also receive it without storage.
  const timeout = setTimeout(() => {}, 0);
  clearTimeout(timeout);
  vi.spyOn(window, "setTimeout").mockReturnValue(timeout);
  initialize.mock.calls[0]?.[0]?.onChange?.({
    cookie,
    changedCategories: ["statistics"],
    changedServices: {},
  });
  expect(channel.postMessage).toHaveBeenCalledTimes(1);
  channel.onmessage?.(new MessageEvent("message", { data: null }));
  expect(reload).toHaveBeenCalledTimes(1);

  channel.postMessage.mockImplementation(() => {
    throw new DOMException("Channel unavailable", "SecurityError");
  });
  expect(() =>
    initialize.mock.calls[0]?.[0]?.onFirstConsent?.({ cookie }),
  ).not.toThrow();
  expect(deliver).toHaveBeenCalledTimes(3);
});
