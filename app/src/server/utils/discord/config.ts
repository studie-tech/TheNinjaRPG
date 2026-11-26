import { DiscordRankRoleKeys } from "@/libs/discordLink";

/**
 * Discord linking configuration. The feature stays off unless `DISCORD_LINKING_ENABLED` is
 * exactly "true" and the application, bot, guild and token key are all configured: routes then
 * answer as disabled, the profile card is hidden and the sync cron does nothing.
 *
 * Values are read from `process.env` on every call, like the Tower Defense claims switch, so
 * a deployment's environment change and tests both take effect without a module reload.
 */
export type DiscordConfig = {
  clientId: string;
  clientSecret: string;
  botToken: string;
  guildId: string;
  /** Role the bot grants to linked members; unset when Linked Roles grants it. */
  verifiedRoleId: string | null;
  /** TNR village id to Discord role id. */
  villageRoleIds: Record<string, string>;
  /** Rank role key (see `discordRankRoleKey`) to Discord role id. */
  rankRoleIds: Record<string, string>;
  /** AES-256 key for stored OAuth tokens. */
  tokenKey: Buffer;
  /** OAuth redirect URI; must be registered in the Discord developer portal. */
  redirectUri: string;
};

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Parse a JSON object of key to Discord role id. Invalid JSON or entries are ignored rather
 * than taking the feature down, since a role mapping typo should not block linking.
 */
const parseRoleIdMap = (
  raw: string | undefined,
  variable: string,
  /** Maps a key to its canonical form, or null to drop the entry. */
  normalizeKey: (key: string) => string | null = (key) => key,
): Record<string, string> => {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const roles: Record<string, string> = {};
    for (const [rawKey, role] of Object.entries(parsed)) {
      const key = normalizeKey(rawKey);
      if (key && typeof role === "string" && SNOWFLAKE.test(role)) roles[key] = role;
    }
    return roles;
  } catch {
    console.error(`[Discord] ${variable} is not valid JSON`);
    return {};
  }
};

/** Parse `DISCORD_VILLAGE_ROLE_IDS`: TNR village id to Discord role id. */
export const parseVillageRoleIds = (raw: string | undefined) =>
  parseRoleIdMap(raw, "DISCORD_VILLAGE_ROLE_IDS");

/**
 * Parse `DISCORD_RANK_ROLE_IDS`: rank role key (`STUDENT`, `GENIN`, ..., `OUTLAW CHUNIN`) to
 * Discord role id. Keys are matched case-insensitively; unknown keys are ignored.
 */
export const parseRankRoleIds = (raw: string | undefined) =>
  parseRoleIdMap(raw, "DISCORD_RANK_ROLE_IDS", (key) => {
    const upper = key.trim().replace(/\s+/g, " ").toUpperCase();
    return DiscordRankRoleKeys.includes(upper) ? upper : null;
  });

/** Accept a 32-byte key as 64 hex characters or base64; anything else disables linking. */
export const parseTokenKey = (raw: string | undefined): Buffer | null => {
  const value = raw?.trim();
  if (!value) return null;
  const key = /^[\da-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
};

/** The complete configuration, or null while the feature is off or incomplete. */
export const getDiscordConfig = (): DiscordConfig | null => {
  const env = process.env;
  if (env.DISCORD_LINKING_ENABLED !== "true") return null;
  const tokenKey = parseTokenKey(env.DISCORD_TOKEN_ENCRYPTION_KEY);
  const baseUrl = env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (
    !env.DISCORD_CLIENT_ID ||
    !env.DISCORD_CLIENT_SECRET ||
    !env.DISCORD_BOT_TOKEN ||
    !env.DISCORD_GUILD_ID ||
    !tokenKey ||
    !baseUrl
  )
    return null;
  return {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    botToken: env.DISCORD_BOT_TOKEN,
    guildId: env.DISCORD_GUILD_ID,
    verifiedRoleId: env.DISCORD_VERIFIED_ROLE_ID?.trim() || null,
    villageRoleIds: parseVillageRoleIds(env.DISCORD_VILLAGE_ROLE_IDS),
    rankRoleIds: parseRankRoleIds(env.DISCORD_RANK_ROLE_IDS),
    tokenKey,
    redirectUri: `${baseUrl}/api/discord/callback`,
  };
};

export const isDiscordLinkingEnabled = () => getDiscordConfig() !== null;
