import { describe, expect, it } from "vitest";
import { TavernColorPresets } from "@/drizzle/constants";
import { getPublicUsersSchema, tavernColorChangeSchema } from "@/validators/user";

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
