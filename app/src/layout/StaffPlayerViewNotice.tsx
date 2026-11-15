"use client";

import Link from "@/layout/Link";
import { isStaffRole } from "@/utils/permissions";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Tells staff who play as a regular player why the manual hides unreleased content, which
 * its editors then cannot show or open, and where to switch back.
 */
export const StaffPlayerViewNotice = () => {
  const pathname = usePublicPathname();
  const { data: userData } = useUserDataSelector((user) => ({
    role: user.role,
    playsAsPlayer: user.playsAsPlayer,
  }));
  if (
    !userData?.playsAsPlayer ||
    !isStaffRole(userData.role) ||
    pathname === "/manual"
  ) {
    return null;
  }
  return (
    <p role="status" className="bg-muted mb-2 rounded-md border px-3 py-2 text-sm">
      You are playing as a regular player, so unreleased content is hidden here. Switch
      it off under{" "}
      <Link href="/manual#staff-tools" className="font-semibold underline">
        Staff tools
      </Link>{" "}
      to see or edit it.
    </p>
  );
};
