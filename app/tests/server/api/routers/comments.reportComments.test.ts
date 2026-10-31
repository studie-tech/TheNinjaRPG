import { describe, expect, it } from "bun:test";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { maskStaffReportCommentAuthors } from "@/server/api/routers/comments";

type Author = Pick<
  UserData,
  "username" | "avatar" | "rank" | "isOutlaw" | "level" | "role" | "federalStatus"
>;

const author = (role: UserData["role"]): Author => ({
  username: `${role.toLowerCase()}-name`,
  avatar: "custom.png",
  rank: "JONIN",
  isOutlaw: true,
  level: 50,
  role,
  federalStatus: "GOLD",
});

describe("report comment author masking", () => {
  it("anonymizes staff, keeps players and tolerates comments without an author row", () => {
    const comments: { user: Author | null }[] = [
      { user: author("HEAD_MODERATOR") },
      { user: author("USER") },
      { user: null },
    ];

    expect(() => maskStaffReportCommentAuthors(comments)).not.toThrow();

    expect(comments[0]?.user).toEqual({
      username: "moderator",
      avatar: IMG_AVATAR_DEFAULT,
      rank: "STUDENT",
      isOutlaw: false,
      level: 0,
      role: "MODERATOR",
      federalStatus: "NONE",
    });
    expect(comments[1]?.user).toEqual(author("USER"));
    expect(comments[2]?.user).toBeNull();
  });
});
