import { useCallback, useRef } from "react";

/**
 * Returns a debounced version of the provided callback.
 * The debounced function will only invoke the callback after the specified delay has elapsed since the last call.
 * @param callback The function to debounce
 * @param delay The debounce delay in ms (default: 250)
 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay = 250,
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay],
  );
}
