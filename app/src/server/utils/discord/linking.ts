import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DiscordUnlinkReason } from "@/drizzle/constants";
import { discordLink, userData } from "@/drizzle/schema";
import {
  type DiscordLinkResult,
  type DiscordLinkResultDetails,
  discordSnowflakeCreatedAt,
} from "@/libs/discordLink";
import type { DrizzleClient } from "@/server/db";
import type { DiscordConfig } from "@/server/utils/discord/config";
import {
  archiveDiscordLink,
  clerkDiscordIdOf,
  findClerkDiscordFlags,
  insertDiscordLink,
  loadLinkCandidate,
  logDiscordAction,
} from "@/server/utils/discord/links";
import {
  DISCORD_OAUTH_SCOPES,
  discordHandle,
  exchangeCode,
  fetchCurrentUser,
  revokeToken,
} from "@/server/utils/discord/rest";
import { evaluateDiscordLink } from "@/server/utils/discord/rules";
import { encryptToken } from "@/server/utils/discord/secrets";
import { releaseDiscordMember, syncDiscordMember } from "@/server/utils/discord/sync";
import type { SanctionIdentity } from "@/server/utils/sanctionTombstone";

export type DiscordLinkOutcome = {
  result: DiscordLinkResult;
} & DiscordLinkResultDetails;

/**
 * Finish the OAuth callback for a verified state: exchange the code, apply the linking rules,
 * store the link and push the Discord side. A rejected attempt revokes the token right away,
 * so nothing is kept for players who were refused.
 */
export const completeDiscordLink = async (
  client: DrizzleClient,
  config: DiscordConfig,
  input: { userId: string; code: string; identity: SanctionIdentity | null },
): Promise<DiscordLinkOutcome> => {
  const tokens = await exchangeCode(config, input.code);
  const granted = tokens.scope.split(" ");
  const revoke = () =>
    revokeToken(config, tokens.refresh_token).catch((error: unknown) => {
      console.error("[Discord] Token revoke failed", error);
    });
  if (
    !["identify", "role_connections.write"].every((scope) => granted.includes(scope))
  ) {
    await revoke();
    return { result: "cancelled" };
  }
  const discordUser = await fetchCurrentUser(tokens.access_token);
  const discordCreatedAt = discordSnowflakeCreatedAt(discordUser.id);
  const { candidate, character, existing } = await loadLinkCandidate(client, {
    userId: input.userId,
    discordId: discordUser.id,
    discordCreatedAt,
  });
  const decision = evaluateDiscordLink(candidate);
  if (!decision.allowed) {
    await revoke();
    const { allowed: _allowed, ...outcome } = decision;
    return outcome;
  }
  const encrypted = {
    accessToken: encryptToken(tokens.access_token, config.tokenKey),
    refreshToken: encryptToken(tokens.refresh_token, config.tokenKey),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope,
  };
  const handle = discordHandle(discordUser);
  const clerkDiscordId = clerkDiscordIdOf(input.identity);
  if (decision.relink && existing) {
    // Same pair again (e.g. the Linked Roles flow from Discord): keep the link, store the
    // fresh tokens and re-apply everything.
    await client
      .update(discordLink)
      .set({ ...encrypted, discordUsername: handle, clerkDiscordId, syncedAt: null })
      .where(eq(discordLink.id, existing.id));
    await syncDiscordMember(client, input.userId, { force: true });
    return { result: "relinked" };
  }
  const inserted = await insertDiscordLink(client, {
    id: nanoid(),
    userId: input.userId,
    discordId: discordUser.id,
    discordUsername: handle,
    discordCreatedAt,
    clerkDiscordId,
    ...encrypted,
  });
  if (!inserted) {
    // A concurrent callback linked one side first.
    await revoke();
    return { result: "linked_elsewhere" };
  }
  const flags = await findClerkDiscordFlags(client, {
    userId: input.userId,
    discordId: discordUser.id,
    clerkDiscordId,
  });
  await Promise.all([
    logDiscordAction(client, {
      actorUserId: input.userId,
      targetUserId: input.userId,
      message: `Linked Discord ${handle}`,
      changes: [
        `Discord: ${handle} (${discordUser.id})`,
        `Discord account created: ${discordCreatedAt.toISOString()}`,
        `Scopes: ${tokens.scope}`,
      ],
      image: character?.avatarLight,
    }),
    ...(flags.length
      ? [
          logDiscordAction(client, {
            actorUserId: input.userId,
            targetUserId: input.userId,
            message: `Discord link flag: ${flags[0]}`,
            changes: flags,
            image: character?.avatarLight,
          }),
        ]
      : []),
  ]);
  await syncDiscordMember(client, input.userId, { force: true });
  return { result: "linked" };
};

/** Scopes as shown to staff; guilds.join is optional for a working link. */
export const describeScopes = (scopes: string) =>
  DISCORD_OAUTH_SCOPES.map(
    (scope) => `${scope}: ${scopes.split(" ").includes(scope) ? "yes" : "no"}`,
  );

/**
 * Remove a link and its Discord side, then archive it for the cooldown. Returns false when
 * the character had no link.
 */
export const removeDiscordLink = async (
  client: DrizzleClient,
  input: {
    userId: string;
    reason: DiscordUnlinkReason;
    actorUserId: string;
    staffNote?: string;
    cooldownWaived?: boolean;
  },
) => {
  const [link, character] = await Promise.all([
    client.query.discordLink.findFirst({ where: eq(discordLink.userId, input.userId) }),
    client.query.userData.findFirst({
      columns: { username: true, avatarLight: true },
      where: eq(userData.userId, input.userId),
    }),
  ]);
  if (!link) return false;
  const cleanup = await releaseDiscordMember(client, link, character?.username ?? "");
  const removed = await archiveDiscordLink(client, link, input.reason, {
    staffUserId: input.reason === "STAFF" ? input.actorUserId : undefined,
    cooldownWaived: input.cooldownWaived,
  });
  if (removed && input.reason !== "ACCOUNT_DELETED") {
    await logDiscordAction(client, {
      actorUserId: input.actorUserId,
      targetUserId: input.userId,
      message:
        input.reason === "STAFF"
          ? `Staff unlinked Discord ${link.discordUsername}`
          : `Unlinked Discord ${link.discordUsername}`,
      changes: [
        `Discord: ${link.discordUsername} (${link.discordId})`,
        ...(input.staffNote ? [`Reason: ${input.staffNote}`] : []),
        ...(input.cooldownWaived ? ["Unlink cooldown waived"] : []),
        ...(cleanup.length
          ? [`Discord cleanup incomplete: ${cleanup.join("; ")}`]
          : []),
      ],
      image: character?.avatarLight,
    });
  }
  return removed;
};
