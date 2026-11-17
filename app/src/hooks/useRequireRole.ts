import { useEffect } from "react";
import type { UserRole } from "@/drizzle/constants";
import { useNavigationRouter } from "@/hooks/navigation";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Require a character whose role passes `check`. Once the character has loaded, any
 * other role is redirected to `redirectTo`. Callers render gated content only after
 * `userData` and `hasAccess` hold, so a denied role never sees it.
 */
export const useRequireRole = (
  check: (role: UserRole) => boolean,
  redirectTo = "/profile",
) => {
  const router = useNavigationRouter();
  const { data: userData } = useRequiredUserData();
  const hasAccess = !!userData && check(userData.role);
  const isDenied = !!userData && !hasAccess;

  useEffect(() => {
    if (isDenied) router.push(redirectTo);
  }, [isDenied, redirectTo, router]);

  return { userData, hasAccess };
};
