import { useEffect, useState, useRef } from "react";

/**
 * useLiveCountdown
 * - Takes an initial remaining seconds value (typically from a server response)
 * - Returns a live countdown that decrements every second
 * - Resyncs when the serverSeconds value changes
 *
 * @param serverSeconds - The remaining seconds from the server (undefined/null treated as 0)
 * @returns The current live countdown in seconds
 */
export const useLiveCountdown = (serverSeconds: number | undefined | null): number => {
  const [liveSeconds, setLiveSeconds] = useState<number>(serverSeconds ?? 0);
  const lastServerValueRef = useRef<number | undefined | null>(serverSeconds);
  const lastSyncTimeRef = useRef<number>(Date.now());

  // Resync when server value changes
  useEffect(() => {
    if (serverSeconds !== lastServerValueRef.current) {
      lastServerValueRef.current = serverSeconds;
      lastSyncTimeRef.current = Date.now();
      setLiveSeconds(serverSeconds ?? 0);
    }
  }, [serverSeconds]);

  // Decrement countdown every second
  useEffect(() => {
    if (liveSeconds <= 0) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - lastSyncTimeRef.current) / 1000;
      const newValue = Math.max(0, (lastServerValueRef.current ?? 0) - elapsed);
      setLiveSeconds(newValue);
    }, 1000);

    return () => clearInterval(interval);
  }, [liveSeconds]);

  return liveSeconds;
};
