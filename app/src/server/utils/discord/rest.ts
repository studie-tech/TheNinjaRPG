import type { DiscordConfig } from "@/server/utils/discord/config";

/**
 * Minimal Discord REST client: OAuth for the linking flow and bot calls for guild
 * management. No gateway connection is used. Requests honor 429 `retry_after` and wait out
 * an exhausted rate-limit bucket before returning, so batch callers can run sequentially
 * without tracking buckets themselves.
 */
export const DISCORD_API = "https://discord.com/api/v10";

/** Scopes requested from the player; guilds.join lets the bot add them to the server. */
export const DISCORD_OAUTH_SCOPES = [
  "identify",
  "role_connections.write",
  "guilds.join",
];

/** Discord JSON error codes this module branches on. */
export const DISCORD_ERROR = {
  unknownMember: 10007,
  unknownUser: 10013,
  unknownBan: 10026,
  missingPermissions: 50013,
} as const;

const MAX_ATTEMPTS = 4;
/** Longer waits are failed instead, so a request never blocks a whole function invocation. */
const MAX_RETRY_WAIT_MS = 30_000;
const MAX_BUCKET_WAIT_MS = 10_000;

export type DiscordRequestError = Error & { status: number; code?: number };

export const isDiscordRequestError = (error: unknown): error is DiscordRequestError =>
  error instanceof Error && typeof (error as DiscordRequestError).status === "number";

const requestError = (status: number, message: string, code?: number) =>
  Object.assign(new Error(message), { status, code }) as DiscordRequestError;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Auth = { bot: string } | { bearer: string } | null;

type DiscordRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: Auth;
  json?: unknown;
  form?: Record<string, string>;
  /** Shown in the guild audit log; Discord limits it to 512 characters. */
  reason?: string;
};

/** Send one request, retrying rate-limited attempts; resolves with the parsed body. */
export const discordRequest = async <T = unknown>(request: DiscordRequest) => {
  const headers: Record<string, string> = {
    "User-Agent": "TheNinja-RPG (https://www.theninja-rpg.com, 1)",
  };
  if (request.auth && "bot" in request.auth)
    headers.Authorization = `Bot ${request.auth.bot}`;
  if (request.auth && "bearer" in request.auth)
    headers.Authorization = `Bearer ${request.auth.bearer}`;
  if (request.reason)
    headers["X-Audit-Log-Reason"] = encodeURIComponent(request.reason.slice(0, 512));
  let body: string | undefined;
  if (request.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(request.form).toString();
  } else if (request.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.json);
  }
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${DISCORD_API}${request.path}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (response.status === 429) {
      const fromBody = (data as { retry_after?: number } | null)?.retry_after;
      const fromHeader = Number(response.headers.get("retry-after"));
      const waitMs =
        (typeof fromBody === "number"
          ? fromBody
          : Number.isFinite(fromHeader)
            ? fromHeader
            : 1) * 1000;
      if (attempt >= MAX_ATTEMPTS || waitMs > MAX_RETRY_WAIT_MS)
        throw requestError(
          429,
          `Discord rate limit on ${request.method} ${request.path}`,
        );
      await sleep(waitMs);
      continue;
    }
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"));
      if (Number.isFinite(resetAfter) && resetAfter > 0)
        await sleep(Math.min(resetAfter * 1000, MAX_BUCKET_WAIT_MS));
    }
    if (!response.ok) {
      const error = data as { code?: number; message?: string; error?: string } | null;
      throw requestError(
        response.status,
        `Discord ${request.method} ${request.path.replace(/\/\d{17,20}/g, "/:id")} failed: ${response.status} ${error?.message ?? error?.error ?? ""}`.trim(),
        error?.code,
      );
    }
    return data as T;
  }
};

/** True for Discord's "unknown ..." answers, which mean the target does not exist. */
export const isDiscordNotFound = (error: unknown) =>
  isDiscordRequestError(error) && error.status === 404;

// ---------------------------------------------------------------- OAuth (player token)

export type DiscordTokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export type DiscordUser = {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
};

/** Display handle: the unique username, with the legacy discriminator when one remains. */
export const discordHandle = (user: DiscordUser) =>
  user.discriminator && user.discriminator !== "0"
    ? `${user.username}#${user.discriminator}`
    : user.username;

export const buildAuthorizeUrl = (config: DiscordConfig, state: string) => {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", DISCORD_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
};

export const exchangeCode = (config: DiscordConfig, code: string) =>
  discordRequest<DiscordTokenSet>({
    method: "POST",
    path: "/oauth2/token",
    auth: null,
    form: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    },
  });

export const refreshAccessToken = (config: DiscordConfig, refreshToken: string) =>
  discordRequest<DiscordTokenSet>({
    method: "POST",
    path: "/oauth2/token",
    auth: null,
    form: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  });

/** Revoking the refresh token also invalidates its access tokens. */
export const revokeToken = (config: DiscordConfig, token: string) =>
  discordRequest({
    method: "POST",
    path: "/oauth2/token/revoke",
    auth: null,
    form: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      token,
      token_type_hint: "refresh_token",
    },
  });

export const fetchCurrentUser = (accessToken: string) =>
  discordRequest<DiscordUser>({
    method: "GET",
    path: "/users/@me",
    auth: { bearer: accessToken },
  });

/** Linked Roles metadata values; Discord expects every value as a string. */
export type DiscordRoleConnection = {
  platformUsername: string;
  linked: boolean;
  level: number;
};

export const putRoleConnection = (
  config: DiscordConfig,
  accessToken: string,
  connection: DiscordRoleConnection,
) =>
  discordRequest({
    method: "PUT",
    path: `/users/@me/applications/${config.clientId}/role-connection`,
    auth: { bearer: accessToken },
    json: {
      platform_name: "TheNinja-RPG",
      platform_username: connection.platformUsername,
      metadata: {
        linked: connection.linked ? "1" : "0",
        level: String(connection.level),
      },
    },
  });

// ---------------------------------------------------------------- Bot (guild management)

/** Metadata a Verified role can require; registered by `bun run discord:register-metadata`. */
export const ROLE_CONNECTION_METADATA = [
  {
    // BOOLEAN_EQUAL
    type: 7,
    key: "linked",
    name: "Linked ninja",
    description: "Has linked a TheNinja-RPG character",
  },
  {
    // INTEGER_GREATER_THAN_OR_EQUAL
    type: 2,
    key: "level",
    name: "Character level",
    description: "Character level at least",
  },
] as const;

export const registerRoleConnectionMetadata = (
  config: Pick<DiscordConfig, "clientId" | "botToken">,
) =>
  discordRequest({
    method: "PUT",
    path: `/applications/${config.clientId}/role-connections/metadata`,
    auth: { bot: config.botToken },
    json: ROLE_CONNECTION_METADATA,
  });

export type DiscordGuildMember = { nick?: string | null; roles: string[] };

/** The guild member, or null when the user is not in the server. */
export const getGuildMember = async (config: DiscordConfig, discordId: string) => {
  try {
    return await discordRequest<DiscordGuildMember>({
      method: "GET",
      path: `/guilds/${config.guildId}/members/${discordId}`,
      auth: { bot: config.botToken },
    });
  } catch (error) {
    if (isDiscordNotFound(error)) return null;
    throw error;
  }
};

/**
 * Add the user to the server with the player's `guilds.join` token. Resolves true when they
 * were added and false when they were already a member (Discord then changes nothing).
 */
export const addGuildMember = async (
  config: DiscordConfig,
  discordId: string,
  member: { accessToken: string; nick: string; roles: string[] },
) => {
  const added = await discordRequest<DiscordGuildMember | null>({
    method: "PUT",
    path: `/guilds/${config.guildId}/members/${discordId}`,
    auth: { bot: config.botToken },
    json: { access_token: member.accessToken, nick: member.nick, roles: member.roles },
  });
  return added !== null;
};

/** Pass null to clear the nickname. */
export const setNickname = (
  config: DiscordConfig,
  discordId: string,
  nick: string | null,
  reason: string,
) =>
  discordRequest({
    method: "PATCH",
    path: `/guilds/${config.guildId}/members/${discordId}`,
    auth: { bot: config.botToken },
    json: { nick },
    reason,
  });

export const addRole = (
  config: DiscordConfig,
  discordId: string,
  roleId: string,
  reason: string,
) =>
  discordRequest({
    method: "PUT",
    path: `/guilds/${config.guildId}/members/${discordId}/roles/${roleId}`,
    auth: { bot: config.botToken },
    reason,
  });

export const removeRole = (
  config: DiscordConfig,
  discordId: string,
  roleId: string,
  reason: string,
) =>
  discordRequest({
    method: "DELETE",
    path: `/guilds/${config.guildId}/members/${discordId}/roles/${roleId}`,
    auth: { bot: config.botToken },
    reason,
  });

export const banMember = (config: DiscordConfig, discordId: string, reason: string) =>
  discordRequest({
    method: "PUT",
    path: `/guilds/${config.guildId}/bans/${discordId}`,
    auth: { bot: config.botToken },
    json: { delete_message_seconds: 0 },
    reason,
  });

/** Resolves false when the user was not banned. */
export const unbanMember = async (
  config: DiscordConfig,
  discordId: string,
  reason: string,
) => {
  try {
    await discordRequest({
      method: "DELETE",
      path: `/guilds/${config.guildId}/bans/${discordId}`,
      auth: { bot: config.botToken },
      reason,
    });
    return true;
  } catch (error) {
    if (isDiscordNotFound(error)) return false;
    throw error;
  }
};
