import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { createMetaPixelTracker } from "@/libs/metaPixel";

const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

beforeEach(() => {
  window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
  delete window.fbq;
  delete window._fbq;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll("script[data-tnr-meta-pixel]").forEach((s) => s.remove());
  delete window.Cookiebot;
  delete window.fbq;
  delete window._fbq;
  if (originalUserAgent)
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  else Reflect.deleteProperty(navigator, "userAgent");
});

const grant = () => {
  window.Cookiebot = { consent: { marketing: true }, hasResponse: true };
};
const load = () => {
  const send = vi.fn();
  if (window.fbq) window.fbq.callMethod = send;
  document
    .querySelector("script[data-tnr-meta-pixel]")
    ?.dispatchEvent(new window.Event("load"));
  return send;
};

describe("Meta acquisition tracking", () => {
  it("isolates third-party SDK failures from game actions", () => {
    grant();
    window.fbq = () => {
      throw new Error("Blocked SDK");
    };
    const pixel = createMetaPixelTracker("12345");
    expect(() => pixel.enable()).not.toThrow();
    expect(() =>
      pixel.confirmedConversion("register", "confirmed-receipt"),
    ).not.toThrow();
    expect(() => pixel.disable()).not.toThrow();
  });

  it("makes no SDK request or events before marketing consent", () => {
    const pixel = createMetaPixelTracker("12345");
    pixel.enable();
    pixel.pageView("/");
    pixel.confirmedConversion("register", "11f90b37-6015-4361-8c51-fbfcccb92b43");
    expect(window.fbq).toBeUndefined();
    expect(document.querySelector("script[data-tnr-meta-pixel]")).toBeNull();
    delete window.Cookiebot;
    pixel.enable();
    expect(window.fbq).toBeUndefined();
  });

  it("deduplicates navigation and confirmed receipts with the exact opaque IDs used by CAPI", () => {
    grant();
    const pixel = createMetaPixelTracker("12345");
    pixel.enable();
    expect(window.fbq?.disablePushState).toBe(true);
    expect(window.fbq?.queue).toContainEqual(["set", "autoConfig", false, "12345"]);
    pixel.pageView("/");
    pixel.pageView("/");
    pixel.confirmedConversion("register", "11f90b37-6015-4361-8c51-fbfcccb92b43");
    pixel.confirmedConversion("register", "11f90b37-6015-4361-8c51-fbfcccb92b43");
    pixel.confirmedConversion("register", undefined);
    const send = load();
    pixel.pageView("/register");
    pixel.confirmedConversion(
      "tutorial_complete",
      "d9b092ee-bf9d-42ad-882b-84ced16aed04",
    );
    pixel.confirmedConversion(
      "tutorial_complete",
      "d9b092ee-bf9d-42ad-882b-84ced16aed04",
    );
    pixel.existingPlayer();
    pixel.existingPlayer();
    expect(send.mock.calls.map((c) => c.slice(0, 4))).toEqual([
      ["trackSingle", "12345", "PageView", {}],
      ["trackSingle", "12345", "CompleteRegistration", {}],
      ["trackSingle", "12345", "PageView", {}],
      ["trackSingleCustom", "12345", "TutorialComplete", {}],
      ["trackSingleCustom", "12345", "ExistingPlayer", {}],
    ]);
    expect(send.mock.calls[1]?.[4]).toEqual({
      eventID: "11f90b37-6015-4361-8c51-fbfcccb92b43",
    });
    expect(send.mock.calls[3]?.[4]).toEqual({
      eventID: "d9b092ee-bf9d-42ad-882b-84ced16aed04",
    });
    expect(send.mock.calls.every((c) => typeof c[4]?.eventID === "string")).toBe(true);
  });

  it("drops delayed events after withdrawal, even if the SDK finishes loading later", () => {
    grant();
    const pixel = createMetaPixelTracker("12345");
    pixel.enable();
    pixel.confirmedConversion("register", "withdrawn-receipt");
    window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
    pixel.disable();
    const send = load();
    pixel.pageView("/home");
    pixel.existingPlayer();
    expect(send).not.toHaveBeenCalled();
    grant();
    pixel.enable();
    expect(send.mock.calls).toEqual([["consent", "grant"]]);
  });

  it("rechecks consent at event time before the React subscription runs", () => {
    grant();
    const pixel = createMetaPixelTracker("12345");
    pixel.enable();
    const send = load();
    window.Cookiebot = { consent: { marketing: false }, hasResponse: true };
    pixel.confirmedConversion("register", "racing-receipt");
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves the landing view through a strict-mode replay during script loading", () => {
    grant();
    const pixel = createMetaPixelTracker("12345");
    pixel.enable();
    pixel.pageView("/");
    pixel.disable();
    pixel.enable();
    pixel.pageView("/");
    const send = load();
    expect(send).toHaveBeenCalledTimes(1);
    pixel.disable();
    pixel.enable();
    pixel.pageView("/");
    expect(send.mock.calls.filter((c) => c[2] === "PageView")).toHaveLength(1);
    expect(document.querySelectorAll("script[data-tnr-meta-pixel]")).toHaveLength(1);
  });

  it("does not initialize in native webviews or with invalid configuration", () => {
    grant();
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "TNR-Native/1.0.0 (android)",
    });
    createMetaPixelTracker("12345").enable();
    expect(window.fbq).toBeUndefined();
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0" });
    createMetaPixelTracker("not-a-pixel").enable();
    expect(window.fbq).toBeUndefined();
  });
});
