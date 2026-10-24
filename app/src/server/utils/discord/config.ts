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
  /** AES-256 key for stored OAuth tokens. */
  tokenKey: Buffer;
  /** OAuth redirect URI; must be registered in the Discord developer portal. */
  redirectUri: string;
};

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Parse `DISCORD_VILLAGE_ROLE_IDS`. Invalid JSON or entries are ignored rather than taking the
 * feature down, since a role mapping typo should not block linking.
 */
export const parseVillageRoleIds = (
  raw: string | undefined,
): Record<string, string> => {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && SNOWFLAKE.test(entry[1]),
      ),
    );
  } catch {
    console.error("[Discord] DISCORD_VILLAGE_ROLE_IDS is not valid JSON");
    return {};
  }
};

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
    tokenKey,
    redirectUri: `${baseUrl}/api/discord/callback`,
  };
};

export const isDiscordLinkingEnabled = () => getDiscordConfig() !== null;
