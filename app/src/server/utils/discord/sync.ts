import { exists } from "drizzle-orm";
import { after } from "next/server";
import {
  ActiveBanStates,
  DISCORD_INDEFINITE_SANCTION_DAYS,
  DISCORD_SYNC_BATCH_SIZE,
  DISCORD_SYNC_REFRESH_DAYS,
} from "@/drizzle/constants";
import type { DiscordLink, discordLink } from "@/drizzle/schema";
import { DISCORD_RELINK_REQUIRED, discordNicknameFor } from "@/libs/discordLink";
import {
  fetchDiscordAccountLinks,
  fetchDiscordAccountSanctions,
  findDiscordAccountIdForUser,
  saveSyncState,
  selectDiscordLinkForFetchLinksNeedingSync,
  selectLinkedForFetchLinksNeedingSync,
  selectPrimaryForFetchLinksNeedingSync,
  setDiscordPrimary,
  updateDiscordLinkForGetClerkLinkAccessToken,
  updateDiscordLinkForGetLinkAccessToken,
} from "@/queries/discord";
import { fetchActiveSanctionTombstones } from "@/queries/reports";
import type { DrizzleClient } from "@/server/db";
import { fetchClerkDiscordToken } from "@/server/utils/discord/clerk";
import { type DiscordConfig, getDiscordConfig } from "@/server/utils/discord/config";
import { discordTombstoneHash } from "@/server/utils/discord/links";
import {
  addGuildMember,
  addRole,
  banMember,
  DISCORD_ERROR,
  getGuildMember,
  hasRequiredScopes,
  isDiscordRequestError,
  putRoleConnection,
  refreshAccessToken,
  removeRole,
  revokeToken,
  setNickname,
  unbanMember,
} from "@/server/utils/discord/rest";
import { decryptToken } from "@/server/utils/discord/secrets";
import { clientErrorMessage } from "@/server/utils/mysqlErrors";
import { logDatabaseFailure } from "@/server/utils/sentry";

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

/** Sync errors are stored on the link and shown to whoever asked for the sync. */
export const errorText = (error: unknown) => {
  logDatabaseFailure(error, "Discord sync failed");
  return (error instanceof Error ? clientErrorMessage(error) : String(error)).slice(
    0,
    200,
  );
};

/** Discord answers 401 to a token the player revoked; only re-linking restores it. */
const tokenErrorText = (error: unknown) =>
  isDiscordRequestError(error) && error.status === 401
    ? relinkRequired("Discord rejected the token").message
    : errorText(error);

/** A member the bot may not edit (owner, higher role); retrying cannot help. */
const isPermissionDenied = (error: unknown) =>
  isDiscordRequestError(error) &&
  (error.status === 403 || error.code === DISCORD_ERROR.missingPermissions);

/** The link has no usable Discord token; only re-linking can restore it. */
const relinkRequired = (detail: string) =>
  new Error(`${DISCORD_RELINK_REQUIRED}: ${detail}`);

/**
 * A valid access token for the link. OAUTH links refresh and store a new pair when the
 * current one is about to expire (Discord rotates refresh tokens, so the new pair is saved
 * immediately). CLERK links ask Clerk, which refreshes its own token, every time.
 */
export const getLinkAccessToken = async (
  client: DrizzleClient,
  config: DiscordConfig,
  link: Pick<
    DiscordLink,
    | "id"
    | "userId"
    | "discordId"
    | "tokenSource"
    | "accessToken"
    | "refreshToken"
    | "tokenExpiresAt"
    | "scopes"
  >,
) => {
  if (link.tokenSource === "CLERK") return getClerkLinkAccessToken(client, link);
  if (!link.accessToken || !link.refreshToken || !link.tokenExpiresAt)
    throw relinkRequired("no stored token");
  if (link.tokenExpiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS > Date.now())
    return decryptToken(link.accessToken, config.tokenKey);
  let tokens: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    tokens = await refreshAccessToken(
      config,
      decryptToken(link.refreshToken, config.tokenKey),
    );
  } catch (error) {
    // invalid_grant: the player revoked the app or the refresh token expired.
    if (isDiscordRequestError(error) && [400, 401].includes(error.status))
      throw relinkRequired("refresh token rejected");
    throw error;
  }
  await updateDiscordLinkForGetLinkAccessToken(client, tokens, config, link);
  return tokens.access_token;
};

/**
 * Clerk's token for a CLERK link. It must still belong to the linked Discord account and
 * carry `role_connections.write`; otherwise the link needs a re-link. Scope changes on
 * Clerk's side (e.g. `guilds.join` added later) are written back to the link.
 */
const getClerkLinkAccessToken = async (
  client: DrizzleClient,
  link: Pick<DiscordLink, "id" | "userId" | "discordId" | "scopes">,
) => {
  const token = await fetchClerkDiscordToken(link.userId, link.discordId);
  if (!token) throw relinkRequired("no Discord sign-in token in Clerk");
  if (!hasRequiredScopes(token.scopes))
    throw relinkRequired("Clerk token lacks role_connections.write");
  const scopes = token.scopes.join(" ");
  if (scopes !== link.scopes)
    await updateDiscordLinkForGetClerkLinkAccessToken(client, scopes, link);
  // The caller's guilds.join check reads the same object.
  link.scopes = scopes;
  return token.accessToken;
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
 * Bring Discord in line with the character's Discord account. The account shows its primary
 * character (see `syncDiscordAccount`), so syncing either linked character syncs both.
 */
export const syncDiscordMember = async (
  client: DrizzleClient,
  userId: string,
  options: { force?: boolean } = {},
) => {
  if (!getDiscordConfig()) return { synced: false, errors: ["disabled"] };
  const link = await findDiscordAccountIdForUser(client, userId);
  if (!link) return { synced: false, errors: ["not linked"] };
  return syncDiscordAccount(client, link.discordId, options);
};

type AccountLink = Awaited<ReturnType<typeof fetchDiscordAccountLinks>>[number];

/**
 * Bring a Discord account in line with its linked characters. Nickname, village role and
 * Linked Roles metadata follow the primary character; the account is banned while any linked
 * character has an indefinite sanction, or while the tombstone of a deleted linked account
 * holds one. With `force`, everything is re-applied even when the stored state already matches
 * (the periodic full refresh and staff resync). The applied state is written to every link of
 * the account, so a primary switch shows up as a mismatch on the new primary.
 */
export const syncDiscordAccount = async (
  client: DrizzleClient,
  discordId: string,
  options: { force?: boolean } = {},
) => {
  const config = getDiscordConfig();
  if (!config) return { synced: false, errors: ["disabled"] };
  const [links, sanctions, tombstones] = await Promise.all([
    fetchDiscordAccountLinks(client, discordId),
    fetchDiscordAccountSanctions(client, discordId),
    fetchActiveSanctionTombstones(client),
  ]);
  const primary = links.find((link) => link.user);
  if (!primary?.user) return { synced: false, errors: ["not linked"] };
  const character = primary.user;
  const force = options.force ?? false;
  const errors: string[] = [];
  const update: Partial<typeof discordLink.$inferInsert> = {};
  if (links.filter((link) => link.isPrimary).length !== 1 || !primary.isPrimary)
    await setDiscordPrimary(client, primary);

  // Indefinite sanction: ban from the server and skip everything else.
  const banReason = discordBanReason(discordId, sanctions, tombstones);
  if (banReason) {
    if (force || links.some((link) => !link.syncedBanned)) {
      try {
        await banMember(config, discordId, banReason);
        update.syncedBanned = true;
      } catch (error) {
        errors.push(`ban: ${errorText(error)}`);
      }
    }
    await saveSyncState(client, discordId, update, errors);
    return { synced: errors.length === 0, errors };
  }
  if (links.some((link) => link.syncedBanned)) {
    try {
      await unbanMember(config, discordId, "TNR sanction lifted");
      update.syncedBanned = false;
    } catch (error) {
      errors.push(`unban: ${errorText(error)}`);
    }
  }

  // Linked Roles metadata needs one of the player's own tokens: the primary's, else another.
  const tokens = new Map<string, Promise<string>>();
  const tokenOf = (link: AccountLink) => {
    let token = tokens.get(link.id);
    if (!token) {
      token = getLinkAccessToken(client, config, link);
      tokens.set(link.id, token);
    }
    return token;
  };
  const anyToken = async () => {
    let firstError: unknown = null;
    for (const link of links) {
      try {
        return await tokenOf(link);
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError;
  };
  if (
    force ||
    primary.syncedLevel !== character.level ||
    primary.syncedUsername !== character.username
  ) {
    try {
      await putRoleConnection(config, await anyToken(), {
        platformUsername: character.username,
        linked: true,
        level: character.level,
      });
      update.syncedLevel = character.level;
    } catch (error) {
      errors.push(`metadata: ${tokenErrorText(error)}`);
    }
  }

  // Server membership, nickname and roles.
  const nick = discordNicknameFor(character.username);
  const wanted = desiredRoles(config, character);
  const needsMember =
    force ||
    primary.syncedUsername !== character.username ||
    primary.syncedVillageId !== character.villageId ||
    update.syncedBanned === false;
  if (needsMember) {
    let applied = true;
    try {
      const member = await getGuildMember(config, discordId);
      if (!member) {
        const joinToken = await guildJoinToken(links, tokenOf);
        if (joinToken) {
          await addGuildMember(config, discordId, {
            accessToken: joinToken,
            nick,
            roles: wanted,
          });
        }
      } else {
        if (member.nick !== nick) {
          try {
            await setNickname(config, discordId, nick, AUDIT_REASON);
          } catch (error) {
            if (!isPermissionDenied(error)) throw error;
            errors.push(`nickname: ${errorText(error)}`);
          }
        }
        const managed = managedRoles(config);
        for (const role of wanted.filter((role) => !member.roles.includes(role)))
          await addRole(config, discordId, role, AUDIT_REASON);
        for (const role of member.roles.filter(
          (role) => managed.has(role) && !wanted.includes(role),
        ))
          await removeRole(config, discordId, role, AUDIT_REASON);
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
  await saveSyncState(client, discordId, update, errors);
  return { synced: errors.length === 0, errors };
};

/**
 * Audit-log reason for banning a Discord account, or null when nothing bans it. A deleted
 * account's tombstone keeps the ban while its sanction is at least as long as an indefinite
 * one, measured from the deletion, so deleting the sanctioned character does not lift the
 * ban of the Discord account its sibling still uses.
 */
const discordBanReason = (
  discordId: string,
  sanctions: Awaited<ReturnType<typeof fetchDiscordAccountSanctions>>,
  tombstones: Awaited<ReturnType<typeof fetchActiveSanctionTombstones>>,
) => {
  const sanction =
    sanctions.find((entry) => ActiveBanStates.includes(entry.status)) ?? sanctions[0];
  if (sanction)
    return `TNR report ${sanction.id}: indefinite ${ActiveBanStates.includes(sanction.status) ? "ban" : "silence"}`;
  const hash = discordTombstoneHash(discordId);
  const tombstone = tombstones.find(
    (entry) =>
      entry.accountHashes.includes(hash) &&
      entry.sanctionEndsAt.getTime() >=
        entry.createdAt.getTime() + DISCORD_INDEFINITE_SANCTION_DAYS * 86_400_000,
  );
  return tombstone
    ? `TNR report ${tombstone.sourceId}: indefinite sanction of a deleted linked account`
    : null;
};

/**
 * A token allowed to add the member to the server, from the first link with `guilds.join`.
 * A CLERK link learns Clerk's current scopes when it fetches the token.
 */
const guildJoinToken = async (
  links: AccountLink[],
  tokenOf: (link: AccountLink) => Promise<string>,
) => {
  for (const link of links) {
    if (link.tokenSource !== "CLERK" && !link.scopes.split(" ").includes("guilds.join"))
      continue;
    try {
      const token = await tokenOf(link);
      if (link.scopes.split(" ").includes("guilds.join")) return token;
    } catch {
      // Reported by the metadata step; try the next link.
    }
  }
  return null;
};

/**
 * Undo the Discord side before the last link of a Discord account is removed: report the role
 * connection as unlinked so Discord drops the Linked Role, remove managed roles and the
 * nickname, and revoke the tokens. A Discord ban stays in place. Never throws. While another
 * character stays linked, none of this runs: the account keeps its role, the remaining link
 * may share the authorization a revoke would end, and a sync applies the remaining character.
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
  // Clerk's sign-in token is Clerk's to keep; only an OAuth pair of our own is revoked.
  if (link.tokenSource === "OAUTH" && link.refreshToken) {
    try {
      await revokeToken(config, decryptToken(link.refreshToken, config.tokenKey));
    } catch (error) {
      errors.push(`revoke: ${errorText(error)}`);
    }
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
 * Links whose Discord account no longer matches its characters, plus links due for the
 * periodic full refresh, oldest sync first. A Discord account banned only through a deleted
 * account's tombstone (keyed hashes, matched in code) shows up hourly; the sync then finds
 * nothing to change.
 */
export const fetchLinksNeedingSync = (client: DrizzleClient, limit: number) => {
  const refreshBefore = new Date(Date.now() - DISCORD_SYNC_REFRESH_DAYS * 86_400_000);

  // Any character linked to the same Discord account has an indefinite sanction.
  const sanctioned = exists(selectLinkedForFetchLinksNeedingSync(client));
  const hasPrimary = exists(selectPrimaryForFetchLinksNeedingSync(client));
  return selectDiscordLinkForFetchLinksNeedingSync(
    client,
    refreshBefore,
    sanctioned,
    hasPrimary,
    limit,
  );
};

/** One cron batch, processed sequentially to stay inside Discord's rate limits. */
export const reconcileDiscordLinks = async (
  client: DrizzleClient,
  limit = DISCORD_SYNC_BATCH_SIZE,
) => {
  if (!getDiscordConfig()) return { processed: 0, failed: 0, skipped: true };
  const refreshBefore = Date.now() - DISCORD_SYNC_REFRESH_DAYS * 86_400_000;
  const links = await fetchLinksNeedingSync(client, limit);
  // Both links of a Discord account sync together; force when either is due.
  const accounts = new Map<string, boolean>();
  for (const link of links) {
    const due = !link.syncedAt || link.syncedAt.getTime() < refreshBefore;
    accounts.set(link.discordId, (accounts.get(link.discordId) ?? false) || due);
  }
  let failed = 0;
  for (const [discordId, force] of accounts) {
    try {
      const result = await syncDiscordAccount(client, discordId, { force });
      if (!result.synced) failed++;
    } catch (error) {
      failed++;
      console.error("[Discord] Reconcile failed", errorText(error));
    }
  }
  return { processed: accounts.size, failed, skipped: false };
};
