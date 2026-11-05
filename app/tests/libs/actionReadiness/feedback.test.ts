import { describe, expect, it } from "bun:test";
import { finishActionFeedback, markActionFeedbackShown, prepareActionFeedback } from "@/libs/actionFeedback";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";

describe("confirmed character recovery feedback", () => {
  it("combines waking with an existing outcome and avoids a second toast", () => {
    const result = { success: true, message: "Training started", actionNotice: AUTO_WAKE_MESSAGE };
    prepareActionFeedback(result);
    expect(result.message).toBe(`Training started ${AUTO_WAKE_MESSAGE}`);
    markActionFeedbackShown({ message: result.message });
    expect(finishActionFeedback(result)).toEqual({ notice: AUTO_WAKE_MESSAGE, needsToast: false });
    expect(finishActionFeedback(result)).toBeUndefined();
  });
  it("falls back for silent mutations and callbacks that only toast failures", () => {
    const result = { success: true, message: "OK", actionNotice: AUTO_CHECKOUT_MESSAGE };
    prepareActionFeedback(result);
    expect(result.message).toBe(AUTO_CHECKOUT_MESSAGE);
    expect(finishActionFeedback(result)).toEqual({ notice: AUTO_CHECKOUT_MESSAGE, needsToast: true });
    const withoutMessage = { success: true, actionNotice: AUTO_WAKE_MESSAGE };
    prepareActionFeedback(withoutMessage);
    expect(finishActionFeedback(withoutMessage)?.needsToast).toBe(true);
  });
  it("reports recovery even if the requested action is rejected afterward", () => {
    const result = { success: false, message: "Not enough Energy", actionNotice: AUTO_WAKE_MESSAGE };
    prepareActionFeedback(result);
    expect(result.message).toContain(AUTO_WAKE_MESSAGE);
    markActionFeedbackShown(result);
    expect(finishActionFeedback(result)?.needsToast).toBe(false);
  });
  it("does not consume another concurrent mutation's feedback", () => {
    const one = { message: "First", actionNotice: AUTO_WAKE_MESSAGE };
    const two = { message: "Second", actionNotice: AUTO_CHECKOUT_MESSAGE };
    prepareActionFeedback(one); prepareActionFeedback(two);
    markActionFeedbackShown(one);
    expect(finishActionFeedback(two)?.needsToast).toBe(true);
    expect(finishActionFeedback(one)?.needsToast).toBe(false);
  });
});

it("recognizes recovery feedback inside a rich toast body", () => {
  const result = { success: true, message: "Done", actionNotice: AUTO_WAKE_MESSAGE };
  prepareActionFeedback(result);
  markActionFeedbackShown({ message: { props: { children: ["Done ", {props: {children: AUTO_WAKE_MESSAGE}}] } } });
  expect(finishActionFeedback(result)?.needsToast).toBe(false);
});
