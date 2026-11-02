import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useUserInfo } from "@/utils/UserContext";

/** Keep the visible Energy queue current without repeating another canonical profile read. */
export const useEnergyQueueRefresh = (enabled: boolean) => {
  const utils = api.useUtils();
  const { timeDiff } = useUserInfo();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    let lastAttemptAt = Date.now();
    const schedule = () => {
      if (disposed) return;
      const lastReadAt = (utils.profile.getUser.getData()?.serverTime ?? 0) + timeDiff;
      timer = setTimeout(
        () => {
          const latestReadAt =
            (utils.profile.getUser.getData()?.serverTime ?? 0) + timeDiff;
          // Local patches retain serverTime and cannot postpone queue recovery.
          if (Date.now() < latestReadAt + 60_000) return schedule();
          lastAttemptAt = Date.now();
          // Join another profile recovery instead of canceling and restarting it.
          void utils.profile.getUser.invalidate(undefined, undefined, {
            cancelRefetch: false,
          });
          schedule();
        },
        Math.max(0, Math.max(lastAttemptAt, lastReadAt) + 60_000 - Date.now()),
      );
    };
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, utils, timeDiff]);
};
