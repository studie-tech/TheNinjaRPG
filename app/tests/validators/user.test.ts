import { describe, expect, it } from "bun:test";
import { TavernColorPresets } from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";
import { AllTags } from "@/validators/combat";
import { getSearchValidator } from "@/validators/register";
import {
  getPublicUsersSchema,
  getBloodlineElements,
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
  it.each([...TavernColorPresets])("accepts the %s preset for both targets", (color) => {
    expect(
      tavernColorChangeSchema.parse({
        target: "username",
        color,
        currentColor: "DEFAULT",
      }),
    ).toEqual({ target: "username", color, currentColor: "DEFAULT" });
    expect(
      tavernColorChangeSchema.parse({
        target: "title",
        color,
        currentColor: "DEFAULT",
      }),
    ).toEqual({ target: "title", color, currentColor: "DEFAULT" });
  });

  it.each(["#1e3a8a", "RED", "GREEN", "EMERALD", "PINK", "ORANGE", "SKY", "PURPLE", "ROSE"])(
    "rejects arbitrary or staff-associated value %s",
    (color) => {
      expect(
        tavernColorChangeSchema.safeParse({
          target: "username",
          color,
          currentColor: "DEFAULT",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unsupported targets", () => {
    expect(
      tavernColorChangeSchema.safeParse({
        target: "post",
        color: "NAVY",
        currentColor: "DEFAULT",
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported current colors", () => {
    expect(
      tavernColorChangeSchema.safeParse({
        target: "username",
        color: "NAVY",
        currentColor: "RED",
      }).success,
    ).toBe(false);
  });
});

describe("bloodline elemental damage tags", () => {
  it("preserves elemental access through parsed beneficial damage tags", () => {
    const effects = [
      AllTags.parse({ type: "increasedamagegiven", elements: ["Fire"], power: 40 }),
      AllTags.parse({ type: "decreasedamagetaken", elements: ["Water"], power: 20 }),
      AllTags.parse({ type: "increasedamagetaken", elements: ["Wind"], power: 20 }),
    ];
    expect(
      getBloodlineElements({
        bloodline: { effects },
      } as NonNullable<UserWithRelations>),
    ).toEqual(["Fire", "Water"]);
  });
});
