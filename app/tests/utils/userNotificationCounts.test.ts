import { describe, expect, it } from "bun:test";
import { withContentReviewCount } from "@/utils/userNotificationCounts";
import type { NavBarDropdownLink } from "@/libs/menus";

describe("content review notification counts", () => {
  const entries: NavBarDropdownLink[] = [
    { href: "/reports", name: "Banned!", color: "red" },
    { href: "/reports", name: "4 waiting!", color: "hidden", notificationCount: 4 },
    { href: "/manual/review", name: "Content review (2)", color: "green", notificationCount: 2 },
    { href: "/profile", name: "Already shown", color: "toast" },
  ];
  it("replaces the review count without clearing report notices", () => {
    const next = withContentReviewCount(entries, 3);
    expect(next).toEqual([entries[0]!, entries[1]!, { href: "/manual/review", name: "Content review (3)", color: "green", notificationCount: 3 }]);
  });
  it("removes completed review counts while retaining unrelated notices", () => {
    expect(withContentReviewCount(entries, 0)).toEqual([entries[0]!, entries[1]!]);
    expect(withContentReviewCount(undefined, 1)).toBeUndefined();
  });
});
