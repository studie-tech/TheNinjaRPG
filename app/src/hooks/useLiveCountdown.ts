import { useEffect, useState, useRef } from "react";

/**
 * useLiveCountdown
 * - Takes an initial remaining seconds value (typically from a server response)
 * - Returns a live countdown that decrements every second
 * - Resyncs when the serverSeconds value changes significantly (>2 second difference)
 *
 * @param serverSeconds - The remaining seconds from the server (undefined/null treated as 0)
 * @returns The current live countdown in seconds
 */
export const useLiveCountdown = (serverSeconds: number | undefined | null): number => {
  // Round to whole seconds for stable comparison
  const roundedServerSeconds = serverSeconds != null ? Math.round(serverSeconds) : 0;

  const [liveSeconds, setLiveSeconds] = useState<number>(roundedServerSeconds);
  const lastServerValueRef = useRef<number>(roundedServerSeconds);
  const lastSyncTimeRef = useRef<number>(Date.now());

  // Resync when server value changes significantly (more than 2 seconds difference)
  // This prevents infinite loops when the input value changes slightly on each render
  useEffect(() => {
    const diff = Math.abs(roundedServerSeconds - lastServerValueRef.current);
    if (diff > 2) {
      lastServerValueRef.current = roundedServerSeconds;
      lastSyncTimeRef.current = Date.now();
      setLiveSeconds(roundedServerSeconds);
    }
  }, [roundedServerSeconds]);

  // Decrement countdown every second
  useEffect(() => {
    if (liveSeconds <= 0) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastSyncTimeRef.current) / 1000;
      const newValue = Math.max(0, lastServerValueRef.current - elapsed);
      setLiveSeconds(newValue);
    }, 1000);

    return () => clearInterval(interval);
  }, [liveSeconds]);

  return liveSeconds;
};
