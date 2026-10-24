import { and, asc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import { after } from "next/server";
import {
  DISCORD_SYNC_BATCH_SIZE,
  DISCORD_SYNC_REFRESH_DAYS,
} from "@/drizzle/constants";
import { type DiscordLink, discordLink, userData, userReport } from "@/drizzle/schema";
import { discordNicknameFor } from "@/libs/discordLink";
import type { DrizzleClient } from "@/server/db";
import { type DiscordConfig, getDiscordConfig } from "@/server/utils/discord/config";
import {
  fetchIndefiniteSanction,
  indefiniteSanctionWhere,
} from "@/server/utils/discord/links";
import {
  addGuildMember,
  addRole,
  banMember,
  DISCORD_ERROR,
  getGuildMember,
  isDiscordRequestError,
  putRoleConnection,
  refreshAccessToken,
  removeRole,
  revokeToken,
  setNickname,
  unbanMember,
} from "@/server/utils/discord/rest";
import { decryptToken, encryptToken } from "@/server/utils/discord/secrets";

/**
 * Discord side of a link: Linked Roles metadata, server membership, nickname, village role
 * and the ban that mirrors an indefinite in-game ban or silence.
 *
 * Every function here is best-effort. In-game actions never wait on or fail because of
 * Discord; whatever did not apply is left out of the `synced*` columns, and the hourly sync
 * cron picks the link up again because its stored state no longer matches the character.
 */

const AUDIT_REASON = "TNR account link sync";
/** Refresh access tokens this long before they expire. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

type SyncCharacter = { username: string; level: number; villageId: string | null };

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 200);

/** A member the bot may not edit (owner, higher role); retrying cannot help. */
const isPermissionDenied = (error: unknown) =>
  isDiscordRequestError(error) &&
  (error.status === 403 || error.code === DISCORD_ERROR.missingPermissions);

/**
 * A valid access token for the link, refreshing and storing a new pair when the current one
 * is about to expire. Discord rotates refresh tokens, so the new pair is saved immediately.
 */
export const getLinkAccessToken = async (
  client: DrizzleClient,
  config: DiscordConfig,
  link: Pick<DiscordLink, "id" | "accessToken" | "refreshToken" | "tokenExpiresAt">,
) => {
  if (link.tokenExpiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS > Date.now())
    return decryptToken(link.accessToken, config.tokenKey);
  const tokens = await refreshAccessToken(
    config,
    decryptToken(link.refreshToken, config.tokenKey),
  );
  await client
    .update(discordLink)
    .set({
      accessToken: encryptToken(tokens.access_token, config.tokenKey),
      refreshToken: encryptToken(tokens.refresh_token, config.tokenKey),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope,
    })
    .where(eq(discordLink.id, link.id));
  return tokens.access_token;
};

/** Roles the sync owns: the verified role and every mapped village role. */
const managedRoles = (config: DiscordConfig) =>
  new Set(
    [config.verifiedRoleId, ...Object.values(config.villageRoleIds)].filter(
      (role): role is string => !!role,
    ),
  );

const desiredRoles = (config: DiscordConfig, character: SyncCharacter) =>
  [
    config.verifiedRoleId,
    character.villageId ? config.villageRoleIds[character.villageId] : undefined,
  ].filter((role): role is string => !!role);

/**
 * Bring Discord in line with the character. With `force`, everything is re-applied even when
 * the stored state already matches (the periodic full refresh and staff resync).
 */
export const syncDiscordMember = async (
  client: DrizzleClient,
  userId: string,
  options: { force?: boolean } = {},
) => {
  const config = getDiscordConfig();
  if (!config) return { synced: false, errors: ["disabled"] };
  const [link, sanction] = await Promise.all([
    client.query.discordLink.findFirst({
      where: eq(discordLink.userId, userId),
      with: { user: { columns: { username: true, level: true, villageId: true } } },
    }),
    fetchIndefiniteSanction(client, userId),
  ]);
  if (!link?.user) return { synced: false, errors: ["not linked"] };
  const character = link.user;
  const force = options.force ?? false;
  const errors: string[] = [];
  const update: Partial<typeof discordLink.$inferInsert> = {};

  // Indefinite sanction: ban from the server and skip everything else.
  if (sanction) {
    if (force || !link.syncedBanned) {
      try {
        await banMember(
          config,
          link.discordId,
          `TNR report ${sanction.id}: indefinite ${sanction.status === "BAN_ACTIVATED" ? "ban" : "silence"}`,
        );
        update.syncedBanned = true;
      } catch (error) {
        errors.push(`ban: ${errorText(error)}`);
      }
    }
    await saveSyncState(client, link.id, update, errors);
    return { synced: errors.length === 0, errors };
  }
  if (link.syncedBanned) {
    try {
      await unbanMember(config, link.discordId, "TNR sanction lifted");
      update.syncedBanned = false;
    } catch (error) {
      errors.push(`unban: ${errorText(error)}`);
    }
  }

  // Linked Roles metadata needs the player's own token.
  let accessToken: string | null = null;
  const tokenFor = async () => {
    accessToken ??= await getLinkAccessToken(client, config, link);
    return accessToken;
  };
  if (
    force ||
    link.syncedLevel !== character.level ||
    link.syncedUsername !== character.username
  ) {
    try {
      await putRoleConnection(config, await tokenFor(), {
        platformUsername: character.username,
        linked: true,
        level: character.level,
      });
      update.syncedLevel = character.level;
    } catch (error) {
      errors.push(`metadata: ${errorText(error)}`);
    }
  }

  // Server membership, nickname and roles.
  const nick = discordNicknameFor(character.username);
  const wanted = desiredRoles(config, character);
  const needsMember =
    force ||
    link.syncedUsername !== character.username ||
    link.syncedVillageId !== character.villageId ||
    update.syncedBanned === false;
  if (needsMember) {
    let applied = true;
    try {
      const member = await getGuildMember(config, link.discordId);
      if (!member) {
        if (link.scopes.split(" ").includes("guilds.join")) {
          await addGuildMember(config, link.discordId, {
            accessToken: await tokenFor(),
            nick,
            roles: wanted,
          });
        }
      } else {
        if (member.nick !== nick) {
          try {
            await setNickname(config, link.discordId, nick, AUDIT_REASON);
          } catch (error) {
            if (!isPermissionDenied(error)) throw error;
            errors.push(`nickname: ${errorText(error)}`);
          }
        }
        const managed = managedRoles(config);
        for (const role of wanted.filter((role) => !member.roles.includes(role)))
          await addRole(config, link.discordId, role, AUDIT_REASON);
        for (const role of member.roles.filter(
          (role) => managed.has(role) && !wanted.includes(role),
        ))
          await removeRole(config, link.discordId, role, AUDIT_REASON);
      }
    } catch (error) {
      applied = false;
      errors.push(`member: ${errorText(error)}`);
    }
    if (applied) {
      update.syncedUsername = character.username;
      update.syncedVillageId = character.villageId;
    }
  }
  await saveSyncState(client, link.id, update, errors);
  return { synced: errors.length === 0, errors };
};

const saveSyncState = (
  client: DrizzleClient,
  linkId: string,
  update: Partial<typeof discordLink.$inferInsert>,
  errors: string[],
) =>
  client
    .update(discordLink)
    .set({
      ...update,
      syncedAt: new Date(),
      syncError: errors.length ? errors.join("; ").slice(0, 500) : null,
    })
    .where(eq(discordLink.id, linkId));

/**
 * Undo the Discord side before a link is removed: report the role connection as unlinked so
 * Discord drops the Linked Role, remove managed roles and the nickname, and revoke the
 * tokens. A Discord ban stays in place. Never throws.
 */
export const releaseDiscordMember = async (
  client: DrizzleClient,
  link: DiscordLink,
  username: string,
) => {
  const config = getDiscordConfig();
  if (!config) return [] as string[];
  const errors: string[] = [];
  try {
    const accessToken = await getLinkAccessToken(client, config, link);
    await putRoleConnection(config, accessToken, {
      platformUsername: username,
      linked: false,
      level: 0,
    });
  } catch (error) {
    errors.push(`metadata: ${errorText(error)}`);
  }
  if (!link.syncedBanned) {
    try {
      const member = await getGuildMember(config, link.discordId);
      if (member) {
        const managed = managedRoles(config);
        for (const role of member.roles.filter((role) => managed.has(role)))
          await removeRole(config, link.discordId, role, "TNR account unlinked");
        if (member.nick)
          await setNickname(config, link.discordId, null, "TNR account unlinked");
      }
    } catch (error) {
      errors.push(`member: ${errorText(error)}`);
    }
  }
  try {
    await revokeToken(config, decryptToken(link.refreshToken, config.tokenKey));
  } catch (error) {
    errors.push(`revoke: ${errorText(error)}`);
  }
  if (errors.length) console.error("[Discord] Unlink cleanup incomplete", errors);
  return errors;
};

/**
 * Run a sync after the response is sent. Moderation, renames and village changes call this
 * so the player sees no Discord latency; failures are left for the cron.
 */
export const scheduleDiscordSync = (client: DrizzleClient, userId: string | null) => {
  if (!userId || !getDiscordConfig()) return;
  const work = () =>
    syncDiscordMember(client, userId).catch((error: unknown) => {
      console.error("[Discord] Sync failed", errorText(error));
    });
  try {
    after(work);
  } catch {
    // Outside a request scope (scripts, tests) there is nothing to defer to.
    void work();
  }
};

/**
 * Links whose Discord state no longer matches the character, plus links due for the periodic
 * full refresh, oldest sync first.
 */
export const fetchLinksNeedingSync = (client: DrizzleClient, limit: number) => {
  const refreshBefore = new Date(Date.now() - DISCORD_SYNC_REFRESH_DAYS * 86_400_000);
  const sanctioned = exists(
    client
      .select({ id: userReport.id })
      .from(userReport)
      .where(indefiniteSanctionWhere(userData.userId)),
  );
  return client
    .select({ userId: discordLink.userId, syncedAt: discordLink.syncedAt })
    .from(discordLink)
    .innerJoin(userData, eq(userData.userId, discordLink.userId))
    .where(
      or(
        isNull(discordLink.syncedAt),
        lt(discordLink.syncedAt, refreshBefore),
        sql`${discordLink.syncedBanned} <> (${sanctioned})`,
        // While banned, nickname, roles and metadata are not applied, so they cannot differ.
        and(
          sql`NOT (${sanctioned})`,
          or(
            sql`NOT (${discordLink.syncedUsername} <=> ${userData.username})`,
            sql`NOT (${discordLink.syncedVillageId} <=> ${userData.villageId})`,
            sql`NOT (${discordLink.syncedLevel} <=> ${userData.level})`,
          ),
        ),
      ),
    )
    .orderBy(asc(discordLink.syncedAt))
    .limit(limit);
};

/** One cron batch, processed sequentially to stay inside Discord's rate limits. */
export const reconcileDiscordLinks = async (
  client: DrizzleClient,
  limit = DISCORD_SYNC_BATCH_SIZE,
) => {
  if (!getDiscordConfig()) return { processed: 0, failed: 0, skipped: true };
  const refreshBefore = Date.now() - DISCORD_SYNC_REFRESH_DAYS * 86_400_000;
  const links = await fetchLinksNeedingSync(client, limit);
  let failed = 0;
  for (const link of links) {
    try {
      const result = await syncDiscordMember(client, link.userId, {
        force: !link.syncedAt || link.syncedAt.getTime() < refreshBefore,
      });
      if (!result.synced) failed++;
    } catch (error) {
      failed++;
      console.error("[Discord] Reconcile failed", errorText(error));
    }
  }
  return { processed: links.length, failed, skipped: false };
};
