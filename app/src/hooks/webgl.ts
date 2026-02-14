import { useEffect, useState } from "react";

/**
 * Hook to detect WebGL2 support in the browser
 * @returns Object with webglError and isChecking states
 */
export const useWebGL2Detection = () => {
  const [webglError, setWebglError] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    // Detect WebGL2 support on mount
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");

    if (!gl) {
      setWebglError(true);
    }

    setIsChecking(false);
  }, []);

  return { webglError, isChecking };
};
