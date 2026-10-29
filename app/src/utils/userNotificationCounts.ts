import type { NavBarDropdownLink } from "@/libs/menus";

/** Replace one authoritative staff counter while preserving unrelated navigation. */
export const withUserNotificationCount = (
  notifications: NavBarDropdownLink[] | undefined,
  kind: "reports" | "contentReview",
  count: number,
): NavBarDropdownLink[] | undefined => {
  if (!notifications) return notifications;
  const href = kind === "reports" ? "/reports" : "/manual/review";
  const next = notifications.filter(
    (entry) =>
      !(
        entry.href === href &&
        (kind === "reports"
          ? entry.color === "hidden"
          : entry.name.startsWith("Content review ("))
      ),
  );
  if (count > 0)
    next.push({
      href,
      name: kind === "reports" ? `${count} waiting!` : `Content review (${count})`,
      color: kind === "reports" ? "hidden" : "green",
      notificationCount: count,
    });
  // Toast messages in the existing profile have already been displayed.
  return next.filter((entry) => entry.color !== "toast");
};
