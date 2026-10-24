import { afterEach, describe, expect, it } from "bun:test";
import {
  getDiscordConfig,
  isDiscordLinkingEnabled,
  parseTokenKey,
  parseVillageRoleIds,
} from "@/server/utils/discord/config";

const KEYS = [
  "DISCORD_LINKING_ENABLED",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_VERIFIED_ROLE_ID",
  "DISCORD_VILLAGE_ROLE_IDS",
  "DISCORD_TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_BASE_URL",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

const configure = (overrides: Partial<Record<(typeof KEYS)[number], string>> = {}) => {
  Object.assign(process.env, {
    DISCORD_LINKING_ENABLED: "true",
    DISCORD_CLIENT_ID: "1111111111111111111",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_BOT_TOKEN: "bot",
    DISCORD_GUILD_ID: "2222222222222222222",
    DISCORD_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    NEXT_PUBLIC_BASE_URL: "https://www.theninja-rpg.com/",
    ...overrides,
  });
};

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("getDiscordConfig", () => {
  it("is off unless the flag is exactly true", () => {
    configure({ DISCORD_LINKING_ENABLED: "false" });
    expect(isDiscordLinkingEnabled()).toBe(false);
    configure({ DISCORD_LINKING_ENABLED: "1" });
    expect(isDiscordLinkingEnabled()).toBe(false);
    configure();
    expect(isDiscordLinkingEnabled()).toBe(true);
  });

  it("is off while any required value is missing", () => {
    for (const key of [
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_BOT_TOKEN",
      "DISCORD_GUILD_ID",
      "DISCORD_TOKEN_ENCRYPTION_KEY",
    ] as const) {
      configure();
      delete process.env[key];
      expect(getDiscordConfig()).toBeNull();
    }
    configure({ DISCORD_TOKEN_ENCRYPTION_KEY: "too-short" });
    expect(getDiscordConfig()).toBeNull();
  });

  it("derives the redirect URI and optional roles", () => {
    configure({
      DISCORD_VERIFIED_ROLE_ID: "3333333333333333333",
      DISCORD_VILLAGE_ROLE_IDS: JSON.stringify({ village1: "4444444444444444444" }),
    });
    const config = getDiscordConfig();
    expect(config?.redirectUri).toBe("https://www.theninja-rpg.com/api/discord/callback");
    expect(config?.verifiedRoleId).toBe("3333333333333333333");
    expect(config?.villageRoleIds).toEqual({ village1: "4444444444444444444" });
  });
});

describe("parsers", () => {
  it("ignores invalid village role mappings", () => {
    expect(parseVillageRoleIds(undefined)).toEqual({});
    expect(parseVillageRoleIds("not json")).toEqual({});
    expect(parseVillageRoleIds("[1,2]")).toEqual({});
    expect(
      parseVillageRoleIds(JSON.stringify({ a: "4444444444444444444", b: 5, c: "role" })),
    ).toEqual({ a: "4444444444444444444" });
  });

  it("accepts 32-byte keys as hex or base64", () => {
    expect(parseTokenKey("ab".repeat(32))?.length).toBe(32);
    expect(parseTokenKey(Buffer.alloc(32, 7).toString("base64"))?.length).toBe(32);
    expect(parseTokenKey(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(parseTokenKey("")).toBeNull();
  });
});
