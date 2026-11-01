import type { NavBarDropdownLink } from "@/libs/menus";

/** Replace the content review count while preserving unrelated navigation. */
export const withContentReviewCount = (
  notifications: NavBarDropdownLink[] | undefined,
  count: number,
): NavBarDropdownLink[] | undefined => {
  if (!notifications) return notifications;
  const next = notifications.filter(
    (entry) =>
      !(entry.href === "/manual/review" && entry.name.startsWith("Content review (")),
  );
  if (count > 0)
    next.push({
      href: "/manual/review",
      name: `Content review (${count})`,
      color: "green",
      notificationCount: count,
    });
  // Toast messages in the existing profile have already been displayed.
  return next.filter((entry) => entry.color !== "toast");
};
