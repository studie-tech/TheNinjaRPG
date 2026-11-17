import { useEffect, useState } from "react";

/**
 * Hook to detect the WebGL the game renderer runs on. It prefers WebGL 1 and accepts WebGL 2.
 * The probe waits for idle time and releases its context at once, so the page it guards
 * neither starts GPU work while it loads nor keeps a context the game does not use.
 * @returns Object with webglError and isChecking states
 */
export const useWebGLDetection = () => {
  const [webglError, setWebglError] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    const probe = () => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") ?? canvas.getContext("webgl2");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      if (!gl) setWebglError(true);
      setIsChecking(false);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(probe, { timeout: PROBE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(probe, PROBE_FALLBACK_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, []);

  return { webglError, isChecking };
};

/** Longest wait for idle time before the probe runs anyway. */
const PROBE_TIMEOUT_MS = 2000;
/** Delay where idle callbacks are unavailable, past the page's first paint. */
const PROBE_FALLBACK_DELAY_MS = 500;
