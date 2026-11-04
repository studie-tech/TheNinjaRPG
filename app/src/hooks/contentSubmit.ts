import { useCallback, useRef } from "react";
import { calculateContentDiff } from "@/utils/diff";

/**
 * Submit content edits one at a time, skipping saves that change nothing. The claim is taken
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
      if (calculateContentDiff(original, next).length === 0) return;
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
