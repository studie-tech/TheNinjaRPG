import { describe, expect, it } from "bun:test";
import { isInjectedWalletRejection } from "@/utils/error";

describe("isInjectedWalletRejection", () => {
  it("matches a wallet extension rejection that has no account", () => {
    expect(
      isInjectedWalletRejection({
        code: 4001,
        message: "wallet must has at least one account",
      }),
    ).toBe(true);
  });

  it("matches the message after it has been wrapped into an Error", () => {
    expect(
      isInjectedWalletRejection({
        message:
          'UnhandledRejection: {"code":4001,"message":"wallet must has at least one account"}',
      }),
    ).toBe(true);
  });

  it("keeps an ordinary application error", () => {
    expect(isInjectedWalletRejection(new Error("Failed query"))).toBe(false);
    expect(isInjectedWalletRejection({ code: 4001, message: "User rejected" })).toBe(
      false,
    );
    expect(isInjectedWalletRejection(null)).toBe(false);
  });
});
