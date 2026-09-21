import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { publicPathForShellPath } from "@/libs/shell";
import type { UserWithRelations } from "../server/api/routers/profile";

/**
 * The pathname as the visitor sees it. usePathname() reports the path a page was rendered
 * under, which for a prerendered page is its shell variant's internal path
 * (/web-pixel-out/home) while the client sees /home; anything branching on it would then
 * render differently on the two sides. This gives both the same value.
 */
export const usePublicPathname = () => {
  const pathname = usePathname();
  return publicPathForShellPath(pathname) ?? pathname;
};

/** The battle whose start has already sent this tab to /combat. */
let navigatedBattleId: string | null = null;

/**
 * Sends the player into a battle, once.
 *
 * A battle start reaches the client twice, about 30ms apart and in either order: the mutation
 * that started it resolves, and the server announces the same battle over the websocket. Both
 * used to call `router.push("/combat")`, and Next treats each as its own navigation, so one
 * battle entry rendered and shipped the /combat RSC payload twice. Keyed on the battle id,
 * whichever signal arrives first navigates and the other becomes a no-op — both remain a
 * fallback for each other if one never arrives.
 */
export const pushToCombat = (
  router: ReturnType<typeof useRouter>,
  battleId: string | null | undefined,
) => {
  if (battleId && navigatedBattleId === battleId) return;
  navigatedBattleId = battleId ?? null;
  router.push("/combat");
};

export const useAwake = (userData: UserWithRelations) => {
  const router = useRouter();
  const pathname = usePublicPathname();
  const userStatus = userData?.status;
  useEffect(() => {
    if (userStatus === "HOSPITALIZED") {
      // showMutationToast({ success: false, message: "Redirecting to hospital" });
      void router.push("/hospital");
    } else if (userStatus === "BATTLE") {
      // showMutationToast({ success: false, message: "Redirecting to combat" });
      void router.push("/combat");
    } else if (userStatus === "TRAVEL" && pathname !== "/travel") {
      // showMutationToast({ success: false, message: "Redirecting to travel" });
      void router.push("/travel");
    } else if (userStatus === "KAGE_QUEUED") {
      // showMutationToast({ success: false, message: "Redirecting to town hall" });
      void router.push("/townhall");
    } else if (userStatus === "ASLEEP") {
      // showMutationToast({ success: false, message: "Redirecting to sleep" });
      void router.push("/home");
    }
  }, [pathname, userStatus, router]);
  return userStatus === "AWAKE";
};
