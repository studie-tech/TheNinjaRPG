import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import * as NativeShell from "@/hooks/useNativeShell";
import { MetaPixel } from "@/layout/MetaPixel";
import { CONSENT_CHANGE_EVENT } from "@/libs/cookieConsent";
import * as pixelTracking from "@/libs/metaPixel";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";

const tracker = {
  enable: vi.fn(),
  disable: vi.fn(),
  pageView: vi.fn(),
  existingPlayer: vi.fn(),
  confirmedConversion: vi.fn(),
};
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

beforeEach(() => {
  for (const fn of Object.values(tracker)) fn.mockClear();
  window.tnrConsent = { consent: { marketing: false }, hasResponse: true };
  vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(false);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/");
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({
    data: false,
  } as never);
  vi.spyOn(pixelTracking, "getMetaPixelTracker").mockReturnValue(tracker);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.tnrConsent;
  if (originalUserAgent)
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  else Reflect.deleteProperty(navigator, "userAgent");
});

it("starts after consent, tracks navigation and existing players, then revokes on withdrawal", () => {
  const view = render(<MetaPixel pixelId="12345" />);
  expect(tracker.enable).not.toHaveBeenCalled();
  window.tnrConsent = { consent: { marketing: true }, hasResponse: true };
  act(() => window.dispatchEvent(new window.Event(CONSENT_CHANGE_EVENT)));
  expect(tracker.enable).toHaveBeenCalledTimes(1);
  expect(tracker.pageView).toHaveBeenCalledWith("/");

  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/home");
  vi.spyOn(userContext, "useUserDataSelector").mockReturnValue({ data: true } as never);
  view.rerender(<MetaPixel pixelId="12345" />);
  expect(tracker.pageView).toHaveBeenLastCalledWith("/home");
  expect(tracker.existingPlayer).toHaveBeenCalledTimes(1);
  expect(tracker.enable).toHaveBeenCalledTimes(1);

  tracker.disable.mockClear();
  window.tnrConsent = { consent: { marketing: false }, hasResponse: true };
  act(() => window.dispatchEvent(new window.Event(CONSENT_CHANGE_EVENT)));
  expect(tracker.disable).toHaveBeenCalled();
  expect(tracker.pageView).toHaveBeenCalledTimes(2);
});

it.each([undefined, true])(
  "does not initialize before web shell resolution (%s)",
  (native) => {
    window.tnrConsent = { consent: { marketing: true }, hasResponse: true };
    vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(native);
    render(<MetaPixel pixelId="12345" />);
    expect(tracker.enable).not.toHaveBeenCalled();
    expect(tracker.pageView).not.toHaveBeenCalled();
  },
);

it("keeps native user agents blocked even if shell detection reports web", () => {
  window.tnrConsent = { consent: { marketing: true }, hasResponse: true };
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "TNR-Native/1.0.0 (android)",
  });
  render(<MetaPixel pixelId="12345" />);
  expect(tracker.enable).not.toHaveBeenCalled();
});
