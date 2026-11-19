import { sendGTMEvent } from "@next/third-parties/google";
import { trackMetaConversion } from "@/libs/metaPixel";

const deliveredConversions = new Set<string>();

/** Send confirmed conversion receipts once per page with stable downstream tracking IDs. */
export const trackConversion = (
  event: "register" | "tutorial_complete",
  conversionId: string | undefined,
) => {
  if (!conversionId) return;
  trackMetaConversion(event, conversionId);
  const transactionId = `${event}:${conversionId}`;
  if (deliveredConversions.has(transactionId)) return;
  try {
    sendGTMEvent({
      event,
      transaction_id: transactionId,
      ...(event === "register" ? { userId: conversionId } : {}),
    });
  } catch {
    // Analytics must never interrupt character creation or reward feedback.
    return;
  }
  deliveredConversions.add(transactionId);
};
