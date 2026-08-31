import { describe, expect, it } from "vitest";
import { TavernColorPresets } from "@/drizzle/constants";
import { getSearchValidator } from "@/validators/register";
import {
  getPublicUsersSchema,
  tavernColorChangeSchema,
  updateUserSchema,
} from "@/validators/user";

describe("getPublicUsersSchema", () => {
  it("accepts farming as a public-user leaderboard order", () => {
    const result = getPublicUsersSchema.parse({
      limit: 30,
      isAi: false,
      orderBy: "Farming",
    });

    expect(result.orderBy).toBe("Farming");
  });
});

describe("updateUserSchema", () => {
  it("allows unchanged legacy reserved titles through to change-aware validation", () => {
    expect(
      updateUserSchema.safeParse({
        username: "LegacyUser",
        customTitle: "Moderator",
        bloodlineId: null,
        sageModeId: null,
        villageId: null,
        role: "USER",
        rank: "STUDENT",
        reason: "Updating an unrelated profile field",
      }).success,
    ).toBe(true);
  });
});

describe("getSearchValidator", () => {
  it("preserves the full optimistic post-as identity", () => {
    const user = {
      userId: "ai-user",
      username: "AiUser",
      avatar: null,
      rank: "JONIN" as const,
      level: 42,
      federalStatus: "NONE" as const,
      role: "EVENT" as const,
      isOutlaw: true,
      customTitle: "Event Host",
      nRecruited: 3,
      tavernMessages: 99,
      tavernUsernameColor: "NAVY" as const,
      tavernTitleColor: "GOLD" as const,
      village: {
        name: "Syndicate",
        hexColor: "#123456",
        kageId: "ai-user",
      },
    };

    expect(
      getSearchValidator({ max: 1 }).parse({ username: "AiUser", users: [user] })
        .users[0],
    ).toEqual(user);
  });
});

describe("tavernColorChangeSchema", () => {
  it.each(TavernColorPresets)("accepts the %s preset for both targets", (color) => {
    expect(tavernColorChangeSchema.parse({ target: "username", color })).toEqual({
      target: "username",
      color,
    });
    expect(tavernColorChangeSchema.parse({ target: "title", color })).toEqual({
      target: "title",
      color,
    });
  });

  it.each(["#1e3a8a", "RED", "GREEN", "EMERALD", "PINK", "ORANGE", "SKY", "PURPLE", "ROSE"])(
    "rejects arbitrary or staff-associated value %s",
    (color) => {
      expect(
        tavernColorChangeSchema.safeParse({ target: "username", color }).success,
      ).toBe(false);
    },
  );

  it("rejects unsupported targets", () => {
    expect(
      tavernColorChangeSchema.safeParse({ target: "post", color: "NAVY" }).success,
    ).toBe(false);
  });
});
