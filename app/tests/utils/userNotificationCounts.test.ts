import { describe, expect, it } from "bun:test";
import { withUserNotificationCount } from "@/utils/userNotificationCounts";
import type { NavBarDropdownLink } from "@/libs/menus";

describe("staff notification counts", () => {
  const entries: NavBarDropdownLink[] = [
    { href: "/reports", name: "Banned!", color: "red" },
    { href: "/reports", name: "4 waiting!", color: "hidden", notificationCount: 4 },
    { href: "/manual/review", name: "Content review (2)", color: "green", notificationCount: 2 },
    { href: "/profile", name: "Already shown", color: "toast" },
  ];
  it("changes the waiting count without clearing sanction or content navigation", () => {
    const next = withUserNotificationCount(entries, "reports", 3);
    expect(next).toEqual([entries[0]!, entries[2]!, { href: "/reports", name: "3 waiting!", color: "hidden", notificationCount: 3 }]);
  });
  it("removes completed review counts while retaining unrelated notices", () => {
    expect(withUserNotificationCount(entries, "contentReview", 0)).toEqual([entries[0]!, entries[1]!]);
    expect(withUserNotificationCount(undefined, "reports", 1)).toBeUndefined();
  });
});
