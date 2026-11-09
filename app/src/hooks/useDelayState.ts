import { useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

/**
 * useDelayState
 * - Returns a stateful value, a setter, and a debounced version of the value.
 * - The debounced value updates only after the specified delay without changes.
 */
export function useDelayState<T>(
  initialValue: T,
  delayMs = 500,
): [T, T, React.Dispatch<React.SetStateAction<T>>] {
  const [immediateValue, setImmediateValue] = useState<T>(initialValue);
  const debouncedValue = useDebouncedValue(immediateValue, delayMs);

  return [immediateValue, debouncedValue, setImmediateValue];
}
