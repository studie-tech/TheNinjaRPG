import { afterEach, describe, expect, it } from "bun:test";
import {
  finishItemConsumeRequest,
  getItemConsumeInput,
  getItemConsumeRequestId,
} from "@/libs/itemConsumption";

afterEach(() => {
  for (const user of ["first", "second"]) finishItemConsumeRequest(user, "stack");
});

describe("item opening request identity", () => {
  it("retains the same request across uncertain retries and isolates accounts", () => {
    const request = getItemConsumeRequestId("first", "stack");
    expect(getItemConsumeRequestId("first", "stack")).toBe(request);
    expect(getItemConsumeRequestId("second", "stack")).not.toBe(request);
    finishItemConsumeRequest("first", "stack");
    expect(getItemConsumeRequestId("first", "stack")).not.toBe(request);
  });
});

describe("item consume input", () => {
  it("sends the meal quantity snapshot the server requires", () => {
    const meal = { id: "stack", quantity: 3, item: { itemType: "MEAL" } };
    expect(getItemConsumeInput("first", meal)).toEqual({
      userItemId: "stack",
      expectedQuantity: 3,
    });
  });

  it("keeps a retryable request identity for other consumables", () => {
    const consumable = { id: "stack", quantity: 2, item: { itemType: "CONSUMABLE" } };
    const input = getItemConsumeInput("first", consumable);
    expect(input).toEqual({
      userItemId: "stack",
      expectedQuantity: 2,
      requestId: getItemConsumeRequestId("first", "stack"),
    });
  });
});
