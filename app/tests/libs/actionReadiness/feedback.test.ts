import { describe, expect, it } from "bun:test";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { actionReadinessResponse } from "@/server/utils/actionReadiness";

describe("endpoint recovery feedback", () => {
  it("combines confirmed waking with the endpoint outcome without mutating its response", () => {
    const result = { success: true, message: "Training started" };
    expect(
      actionReadinessResponse(result, { notice: AUTO_WAKE_MESSAGE }),
    ).toMatchObject({
      success: true,
      message: `Training started ${AUTO_WAKE_MESSAGE}`,
      actionNotice: AUTO_WAKE_MESSAGE,
    });
    expect(result.message).toBe("Training started");
  });
  it("supplies a notice for otherwise silent outcomes", () => {
    expect(
      actionReadinessResponse(
        { success: true, message: "OK" },
        { notice: AUTO_CHECKOUT_MESSAGE },
      ),
    ).toMatchObject({
      message: AUTO_CHECKOUT_MESSAGE,
      actionNotice: AUTO_CHECKOUT_MESSAGE,
    });
  });
  it("can report a committed transition when a later action phase rejects", () => {
    expect(
      actionReadinessResponse(
        { success: false, message: "Roll failed" },
        { notice: AUTO_WAKE_MESSAGE },
      ).message,
    ).toBe(`Roll failed ${AUTO_WAKE_MESSAGE}`);
  });
  it("leaves outcomes unchanged when no recovery committed", () => {
    const result = { success: false, message: "Not enough Energy" };
    expect(actionReadinessResponse(result, undefined)).toBe(result);
    expect(actionReadinessResponse(result, {})).toBe(result);
  });
});
