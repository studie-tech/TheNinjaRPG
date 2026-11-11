import { usePathname, type useRouter } from "next/navigation";
import { useEffect } from "react";
import { useNavigationRouter } from "@/hooks/navigation";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { publicPathForShellPath } from "@/libs/shell";
import type { UserWithRelations } from "@/routers/profile";

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

/**
 * The sign-in page, returning to `path` afterwards when it is a same-site game path.
 * Entry pages and anything that is not a plain absolute path sign in without a return.
 */
export const loginRedirectPath = (path: string) => {
  const isSameSite =
    path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
  const pagePath = path.split(/[?#]/)[0];
  if (!isSameSite || ["/", "/login", "/signup"].includes(pagePath ?? ""))
    return "/login";
  return `/login?redirect_url=${encodeURIComponent(path)}`;
};

/** The battle whose start has already sent this tab to /combat. */
let navigatedBattleId: string | null = null;

/**
 * Sends the player into a battle, once.
 *
 * A battle start reaches the client twice, about 30ms apart and in either order: the mutation
 * that started it resolves, and the server announces the same battle over the websocket. Next
 * treats each `router.push("/combat")` as its own navigation, so pushing on both would render
 * and ship the /combat RSC payload twice for one battle entry. Keyed on the battle id,
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

/** Route unavailable actors to their activity page; action pages may admit eligible recovery. */
export const useAwake = (
  userData: UserWithRelations,
  { allowActionRecovery = false }: { allowActionRecovery?: boolean } = {},
) => {
  const router = useNavigationRouter();
  const pathname = usePublicPathname();
  const userStatus = userData?.status;
  const canRecover = allowActionRecovery && canAttemptAwakeAction(userData);
  useEffect(() => {
    if (canRecover) return;
    if (userStatus === "HOSPITALIZED") {
      void router.replace("/hospital");
    } else if (userStatus === "BATTLE") {
      void router.replace("/combat");
    } else if (userStatus === "TRAVEL" && pathname !== "/travel") {
      void router.replace("/travel");
    } else if (userStatus === "ASLEEP") {
      void router.replace("/home");
    }
  }, [pathname, userStatus, router, canRecover]);
  return userStatus === "AWAKE";
};
