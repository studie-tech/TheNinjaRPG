import { useEffect, useState } from "react";

/**
 * Hook to detect the WebGL the game renderer runs on. It prefers WebGL 1 and accepts WebGL 2.
 * @returns Object with webglError and isChecking states
 */
export const useWebGLDetection = () => {
  const [webglError, setWebglError] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    // Detect WebGL support on mount
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("webgl2");

    if (!gl) {
      setWebglError(true);
    }

    setIsChecking(false);
  }, []);

  return { webglError, isChecking };
};
