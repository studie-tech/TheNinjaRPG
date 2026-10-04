import { useEffect, useState } from "react";
import { appEvents, isNative } from "@/libs/native";

/** Visible browser windows remain active even when another window has focus. */
export const usePageActive = () => {
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    let isAppActive = true;
    const update = () => setIsActive(isAppActive && !document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    const unsubscribe = isNative()
      ? appEvents.onStateChange((active) => {
          isAppActive = active;
          update();
        })
      : undefined;
    return () => {
      document.removeEventListener("visibilitychange", update);
      unsubscribe?.();
    };
  }, []);

  return isActive;
};
