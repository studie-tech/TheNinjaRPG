import { useCallback, useRef } from "react";
import { showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";

/**
 * Submit content edits one at a time, skipping saves that change nothing and telling the
 * editor so, since the save button stays enabled without edits. The claim is taken
 * synchronously because React Query's pending state arrives too late to stop a double-click.
 * A rejected save resolves here: the mutation's error handling reports it, and the editor
 * keeps its draft for a deliberate retry.
 */
export const useContentSubmit = () => {
  const submitInFlight = useRef(false);
  return useCallback(
    async <T extends object>(
      original: T,
      next: T,
      save: (next: T) => Promise<unknown>,
    ) => {
      if (submitInFlight.current) return;
      if (calculateContentDiff(original, next).length === 0) {
        showMutationToast({
          success: true,
          title: "Nothing to save",
          message: "No changes to save",
          id: "content-submit-no-changes",
        });
        return;
      }
      submitInFlight.current = true;
      try {
        await save(next);
      } catch {
        // See the contract above.
      } finally {
        submitInFlight.current = false;
      }
    },
    [],
  );
};
