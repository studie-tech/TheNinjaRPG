import { describe, expect, it } from "bun:test";
import { DISCORD_MIN_ACCOUNT_AGE_DAYS } from "@/drizzle/constants";
import {
  DiscordLinkResults,
  describeDiscordLinkResult,
  discordAccountEligibleAt,
  discordNicknameFor,
  discordRankRoleId,
  discordRankRoleKey,
  discordSnowflakeCreatedAt,
  isDiscordLinkResult,
  maskName,
} from "@/libs/discordLink";

describe("discordSnowflakeCreatedAt", () => {
  it("reads the timestamp encoded in a snowflake", () => {
    // Example from Discord's API reference: 175928847299117063 -> 2016-04-30T11:18:25.796Z
    expect(discordSnowflakeCreatedAt("175928847299117063").toISOString()).toBe(
      "2016-04-30T11:18:25.796Z",
    );
  });

  it("round-trips a snowflake built from a known date", () => {
    const createdAt = new Date("2026-10-01T12:00:00.000Z");
    const snowflake = (
      (BigInt(createdAt.getTime()) - 1_420_070_400_000n) <<
      22n
    ).toString();
    expect(discordSnowflakeCreatedAt(snowflake).getTime()).toBe(createdAt.getTime());
  });

  it("rejects values that are not snowflakes", () => {
    expect(() => discordSnowflakeCreatedAt("abc")).toThrow();
    expect(() => discordSnowflakeCreatedAt("")).toThrow();
  });
});

describe("discordAccountEligibleAt", () => {
  it("adds the minimum account age", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(discordAccountEligibleAt(createdAt).getTime() - createdAt.getTime()).toBe(
      DISCORD_MIN_ACCOUNT_AGE_DAYS * 86_400_000,
    );
  });
});

describe("maskName", () => {
  it("keeps only the first and last character", () => {
    expect(maskName("Terriator")).toBe("T******r");
    expect(maskName("Abc")).toBe("A*c");
    expect(maskName("Ab")).toBe("**");
    expect(maskName("")).toBe("*");
  });
});

describe("discordNicknameFor", () => {
  it("truncates to Discord's 32 character limit", () => {
    expect(discordNicknameFor("Naruto")).toBe("Naruto");
    expect(discordNicknameFor("x".repeat(40))).toHaveLength(32);
  });
});

describe("result copy", () => {
  it("describes every result and recognizes only known codes", () => {
    for (const result of DiscordLinkResults) {
      const copy = describeDiscordLinkResult(result, {
        hint: "T***r",
        until: "2026-11-01T00:00:00.000Z",
      });
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(isDiscordLinkResult(result)).toBe(true);
    }
    expect(isDiscordLinkResult("hacked")).toBe(false);
    expect(
      describeDiscordLinkResult("discord_full", { hint: "T***r" }).description,
    ).toContain("T***r");
    expect(
      describeDiscordLinkResult("cooldown", { until: "2026-11-01T00:00:00.000Z" })
        .description,
    ).toContain("01 Nov 2026");
  });
});

describe("discord rank roles", () => {
  it("keys a character by rank, with outlaws apart", () => {
    expect(discordRankRoleKey({ rank: "STUDENT", isOutlaw: false })).toBe("STUDENT");
    expect(discordRankRoleKey({ rank: "ELITE JONIN", isOutlaw: false })).toBe(
      "ELITE JONIN",
    );
    expect(discordRankRoleKey({ rank: "CHUNIN", isOutlaw: true })).toBe(
      "OUTLAW CHUNIN",
    );
    expect(discordRankRoleKey({ rank: "NONE", isOutlaw: false })).toBeNull();
  });

  it("uses the outlaw role when mapped and the plain rank's otherwise", () => {
    const roles = { GENIN: "1", CHUNIN: "2", "OUTLAW CHUNIN": "3" };
    expect(discordRankRoleId(roles, "CHUNIN")).toBe("2");
    expect(discordRankRoleId(roles, "OUTLAW CHUNIN")).toBe("3");
    expect(discordRankRoleId(roles, "OUTLAW GENIN")).toBe("1");
    expect(discordRankRoleId(roles, "JONIN")).toBeUndefined();
    expect(discordRankRoleId(roles, null)).toBeUndefined();
  });
});
