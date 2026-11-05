import { showMutationToast } from "@/libs/toast";
import { isRetryableTrpcError } from "@/utils/error";

/**
 * Failure toast for a mutation with `meta: { handlesTransportError: true }`: the global handler
 * stays silent on retryable transport errors for those, so the caller reports them here.
 * Anything else is ignored, because the global handler has already reported it.
 */
export const showRetryableErrorToast = (error: unknown, message: string) => {
  if (error instanceof Error && isRetryableTrpcError(error)) {
    showMutationToast({ success: false, message });
  }
};
