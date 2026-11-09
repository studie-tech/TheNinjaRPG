import { describe, expect, it } from "bun:test";
import { isPayPalCleanupError, isPayPalSdkStack } from "@/utils/error";

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

describe("isPayPalSdkStack", () => {
  /** The ways browsers print a frame, each above one of our own frames. */
  const stacks = (url: string) => [
    `Error: closed\n    at ZalgoPromise.dispatch (${url}:2:1234)\n    at https://www.theninja-rpg.com/app.js:1:5`,
    `Error: closed\n    at ${url}:2:1234`,
    `Error: closed\n    at async Object.resolve [as next] (${url}:2:1234)`,
    `dispatch/<@${url}:2:1234\nresolve@https://www.theninja-rpg.com/app.js:1:5`,
    `@${url}:2:1234`,
    `global code@${url}:2:1234`,
  ];

  it.each([
    "https://www.paypal.com/sdk/js?client-id=abc&currency=USD&intent=capture",
    "https://www.sandbox.paypal.com/sdk/js?client-id=abc",
    "https://www.paypal.com/sdk/js",
    "https://paypal.com/smart/buttons?token=abc",
    "https://www.paypalobjects.com/api/checkout.js",
    "https://www.paypal.com:443/sdk/js",
  ])("matches frames served from %s", (url) => {
    for (const stack of stacks(url)) expect(isPayPalSdkStack(stack)).toBe(true);
  });

  it.each([
    "https://paypal.com.evil.example/sdk/js",
    "https://www.paypal.com.evil.example/sdk/js?client-id=abc",
    "https://evilpaypal.com/sdk/js",
    "https://www.paypal.com@evil.example/sdk/js",
    "https://evil.example/www.paypal.com/sdk/js",
    "https://evil.example/?u=https://www.paypal.com/sdk/js",
    "https://evil.example/(https://www.paypal.com/sdk/js",
    "https://evil.example/@https://www.paypal.com/sdk/js",
    "https://connect.example.com/sdk/js",
    "https://www.theninja-rpg.com/_next/static/chunks/paypal-1a2b.js",
    "app:///_next/static/chunks/paypal-1a2b.js",
    "app:///src/utils/paypal.ts",
  ])("keeps frames served from %s", (url) => {
    for (const stack of stacks(url)) expect(isPayPalSdkStack(stack)).toBe(false);
  });

  it("keeps an error that only mentions PayPal", () => {
    expect(
      isPayPalSdkStack(
        "Error: see https://www.paypal.com/sdk/js\n    at f (https://a.example/b.js:1:1)",
      ),
    ).toBe(false);
  });

  it("keeps an error without a stack", () => {
    expect(isPayPalSdkStack(undefined)).toBe(false);
    expect(isPayPalSdkStack("")).toBe(false);
  });
});
