import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";

type Feedback = { result: Record<string, unknown>; notice: string; shown: boolean };
const pending = new Set<Feedback>();

/** Add confirmed recovery feedback before feature callbacks choose their toast. */
export const prepareActionFeedback = (result: unknown) => {
  if (!result || typeof result !== "object" || !("actionNotice" in result)) return;
  const notice = result.actionNotice;
  if (notice !== AUTO_WAKE_MESSAGE && notice !== AUTO_CHECKOUT_MESSAGE) return;
  const data = result as Record<string, unknown>;
  const feedback = { result: data, notice, shown: false };
  if (typeof data.message === "string") {
    data.message =
      data.message && data.message !== "OK" ? `${data.message} ${notice}` : notice;
  }
  pending.add(feedback);
};

/** Mark feedback included in a feature toast, including copies of its response message. */
export const markActionFeedbackShown = (data: { message: unknown }) => {
  for (const feedback of pending) {
    if (
      feedback.result === data ||
      feedback.result.message === data.message ||
      containsNotice(data.message, feedback.notice)
    )
      feedback.shown = true;
  }
};

/** Return a fallback only when the feature callbacks did not toast this confirmed recovery. */
export const finishActionFeedback = (result: unknown) => {
  for (const feedback of pending) {
    if (feedback.result === result) {
      pending.delete(feedback);
      return { notice: feedback.notice, needsToast: !feedback.shown };
    }
  }
};

/** Rich toast bodies retain the recovery sentence through HTML and JSX wrappers. */
const containsNotice = (message: unknown, notice: string): boolean => {
  if (typeof message === "string") return message.includes(notice);
  if (Array.isArray(message))
    return message.some((child) => containsNotice(child, notice));
  if (message && typeof message === "object" && "props" in message) {
    const props = message.props;
    if (props && typeof props === "object" && "children" in props)
      return containsNotice(props.children, notice);
  }
  return false;
};
