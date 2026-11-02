import {
  ActiveBanStates,
  DISCORD_UNLINK_COOLDOWN_DAYS,
  type DiscordUnlinkReason,
} from "@/drizzle/constants";
import type { DiscordLink, discordLink } from "@/drizzle/schema";
import {
  deleteDiscordLinkForArchiveDiscordLink,
  fetchDiscordAccountSanctions,
  findDiscordLinkForUser,
  findUserDataForLoadLinkCandidate,
  insertDiscordLinkForInsertDiscordLink,
  insertDiscordLinkHistoryForArchiveDiscordLink,
  listDiscordLinkForFindClerkDiscordFlags,
  listDiscordLinkForLoadLinkCandidate,
  listDiscordLinkHistoryForLoadLinkCandidate,
  selectUserReportForFetchIndefiniteSanction,
  selectUserReportForLoadLinkCandidate,
} from "@/queries/discord";
import { fetchActiveSanctionTombstones } from "@/queries/reports";
import type { DrizzleClient } from "@/server/db";
import { isClerkDiscordProvider } from "@/server/utils/discord/clerk";
import type { DiscordLinkCandidate } from "@/server/utils/discord/rules";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import {
  hashSanctionIdentifier,
  type SanctionIdentity,
} from "@/server/utils/sanctionTombstone";

/**
 * Tombstones hash linked OAuth identities as `<provider>:<provider user id>`; a linked
 * Discord account uses the same form as a Discord login, so either one blocks re-linking.
 */
export const discordTombstoneHash = (discordId: string) =>
  hashSanctionIdentifier("oauth", `discord:${discordId}`);

/** The Discord id a character signs in with through Clerk, if any. */
export const clerkDiscordIdOf = (identity: SanctionIdentity | null) =>
  identity?.externalAccounts.find((account) => isClerkDiscordProvider(account.provider))
    ?.providerUserId ?? null;

/** The report behind an indefinite ban or silence, preferring bans. */
export const fetchIndefiniteSanction = async (
  client: DrizzleClient,
  userId: string,
) => {
  const reports = await selectUserReportForFetchIndefiniteSanction(client, userId);
  return (
    reports.find((report) => ActiveBanStates.includes(report.status)) ??
    reports[0] ??
    null
  );
};

/** Load everything the linking rules need in one round of parallel reads. */
export const loadLinkCandidate = async (
  client: DrizzleClient,
  input: { userId: string; discordId: string; discordCreatedAt: Date },
) => {
  const cooldownStart = new Date(
    Date.now() - DISCORD_UNLINK_COOLDOWN_DAYS * 86_400_000,
  );
  const [
    character,
    linkForUser,
    linksForDiscord,
    history,
    sanctions,
    tombstones,
    discordSanctions,
  ] = await Promise.all([
    findUserDataForLoadLinkCandidate(client, input),
    findDiscordLinkForUser(client, input),
    listDiscordLinkForLoadLinkCandidate(client, input),
    listDiscordLinkHistoryForLoadLinkCandidate(client, input, cooldownStart),
    selectUserReportForLoadLinkCandidate(client, input),
    fetchActiveSanctionTombstones(client),
    fetchDiscordAccountSanctions(client, input.discordId),
  ]);
  const hash = discordTombstoneHash(input.discordId);
  const candidate: DiscordLinkCandidate = {
    userId: input.userId,
    discordId: input.discordId,
    discordCreatedAt: input.discordCreatedAt,
    character: character ? { isBanned: character.isBanned } : null,
    hasBlockingSanction: sanctions.length > 0,
    matchesSanctionTombstone: tombstones.some((tombstone) =>
      tombstone.accountHashes.includes(hash),
    ),
    discordBanned:
      discordSanctions.length > 0 || linksForDiscord.some((link) => link.syncedBanned),
    linkForUser: linkForUser ? { discordId: linkForUser.discordId } : null,
    linksForDiscord: linksForDiscord.map((link) => ({
      userId: link.userId,
      slot: link.slot,
      isPrimary: link.isPrimary,
      username: link.user?.username ?? null,
    })),
    history,
  };
  return { candidate, character, existing: linkForUser ?? null };
};

/**
 * Insert a link. The unique keys on userId and (discordId, slot) settle a race between two
 * callbacks for the same character or the same free slot of a Discord account: the loser gets
 * false, so a Discord account never exceeds its slots.
 */
export const insertDiscordLink = async (
  client: DrizzleClient,
  values: typeof discordLink.$inferInsert,
) => {
  try {
    await insertDiscordLinkForInsertDiscordLink(client, values);
    return true;
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) return false;
    throw error;
  }
};

/**
 * End a link: archive it, then delete it. History is keyed by the link id, so a retry after
 * a failed delete archives nothing twice. Two ordered writes keep this restartable without a
 * transaction; the worst partial outcome is a history row whose link still exists, which the
 * cooldown check ignores for the same pair.
 */
export const archiveDiscordLink = async (
  client: DrizzleClient,
  link: Pick<
    DiscordLink,
    "id" | "userId" | "discordId" | "discordUsername" | "linkedAt"
  >,
  reason: DiscordUnlinkReason,
  options: { staffUserId?: string; cooldownWaived?: boolean } = {},
) => {
  await insertDiscordLinkHistoryForArchiveDiscordLink(client, link, reason, options);
  const result = await deleteDiscordLinkForArchiveDiscordLink(client, link);
  return result.rowsAffected > 0;
};

/**
 * Staff-visible abuse signals around Clerk Discord logins; they never block linking. Other
 * characters linked to the same Discord account are a declared second account, not a flag.
 */
export const findClerkDiscordFlags = async (
  client: DrizzleClient,
  input: { userId: string; discordId: string; clerkDiscordId: string | null },
) => {
  const flags: string[] = [];
  if (input.clerkDiscordId && input.clerkDiscordId !== input.discordId)
    flags.push(
      `Linked Discord ${input.discordId} differs from the Discord login ${input.clerkDiscordId} of this account`,
    );
  const related = await listDiscordLinkForFindClerkDiscordFlags(client, input);
  for (const link of related) {
    const name = link.user?.username ?? link.userId;
    if (link.clerkDiscordId === input.discordId)
      flags.push(
        `Discord ${input.discordId} is the Discord login of another character: ${name}`,
      );
    if (input.clerkDiscordId && link.discordId === input.clerkDiscordId)
      flags.push(
        `This account's Discord login ${input.clerkDiscordId} is linked to another character: ${name}`,
      );
  }
  return flags;
};
