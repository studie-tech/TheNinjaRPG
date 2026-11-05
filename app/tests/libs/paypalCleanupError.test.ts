import { describe, expect, it } from "bun:test";
import { isPayPalCleanupError } from "@/utils/error";

describe("isPayPalCleanupError", () => {
  it.each([
    "Error: zoid destroyed all components",
    "Error: Detected popup close",
    "Error: Window closed",
    "Error: Component closed",
    "Error: Target window is closed",
  ])("matches %s", (message) => {
    expect(isPayPalCleanupError(new Error(message))).toBe(true);
  });

  it("keeps cross-window SDK failures visible to the checkout page", () => {
    expect(isPayPalCleanupError(new Error("postrobot_method"))).toBe(false);
    expect(isPayPalCleanupError(new Error("paypal_js_sdk_v5"))).toBe(false);
  });

  it("keeps ordinary errors and empty values", () => {
    expect(isPayPalCleanupError(new Error("Payment declined"))).toBe(false);
    expect(isPayPalCleanupError(undefined)).toBe(false);
  });
});
