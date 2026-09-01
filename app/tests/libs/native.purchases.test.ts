import { describe, expect, it } from "vitest";
import { purchaseErrorOutcome } from "@/libs/native/purchases";

describe("native purchase errors", () => {
  it("uses RevenueCat's code instead of ambiguous message matching", () => {
    expect(
      purchaseErrorOutcome({ code: "1", message: "Purchase cancelled" }),
    ).toEqual({ status: "cancelled" });
    expect(
      purchaseErrorOutcome({
        code: "2",
        message: "StoreProblem after cancellation handshake",
      }),
    ).toEqual({
      status: "error",
      code: "2",
      message: "StoreProblem after cancellation handshake",
      mayHaveCharged: true,
    });
  });

  it("only calls explicit pre-charge failures safe to retry", () => {
    expect(
      purchaseErrorOutcome({ code: "5", message: "Product unavailable" }),
    ).toMatchObject({ status: "error", code: "5", mayHaveCharged: false });
    expect(
      purchaseErrorOutcome({ code: "20", message: "Payment pending" }),
    ).toMatchObject({ status: "error", code: "20", mayHaveCharged: true });
    expect(purchaseErrorOutcome(new Error("Bridge disconnected"))).toMatchObject({
      status: "error",
      mayHaveCharged: true,
    });
  });
});
