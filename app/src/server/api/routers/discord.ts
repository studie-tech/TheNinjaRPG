import { z } from "zod";
import { DISCORD_UNLINK_COOLDOWN_DAYS } from "@/drizzle/constants";
import { needsDiscordRelink } from "@/libs/discordLink";
import {
  fetchDiscordActionLog,
  findDiscordLinkForGetStatus,
  findDiscordLinkForSetPrimary,
  findDiscordLinkForUnlink,
  listDiscordLinkForGetStatus,
  logDiscordAction,
  selectDiscordLinkForSearchLinks,
  selectDiscordLinkHistoryForSearchLinks,
  selectDistinctDiscordLinkForSearchLinks,
  setDiscordPrimary,
} from "@/queries/discord";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { isDiscordLinkingEnabled } from "@/server/utils/discord/config";
import { describeScopes, removeDiscordLink } from "@/server/utils/discord/linking";
import { fetchIndefiniteSanction } from "@/server/utils/discord/links";
import { scheduleDiscordSync, syncDiscordMember } from "@/server/utils/discord/sync";
import { canManageDiscordLinks, canViewDiscordLinks } from "@/utils/permissions";

export const discordRouter = createTRPCRouter({
  /**
   * Whether linking is available, and the signed-in character's link if any, with the other
   * character linked to the same Discord account.
   */
  getStatus: publicProcedure.query(async ({ ctx }) => {
    if (!isDiscordLinkingEnabled() || !ctx.userId)
      return { enabled: isDiscordLinkingEnabled(), link: null };
    const link = await findDiscordLinkForGetStatus(ctx.drizzle, { userId: ctx.userId });
    if (!link) return { enabled: true, link: null };
    // Depends on the link's Discord id; ordered like the sync, which picks the first.
    const links = await listDiscordLinkForGetStatus(ctx.drizzle, link);
    const { syncError, discordId: _discordId, ...rest } = link;
    const sibling = links.find((entry) => entry.userId !== ctx.userId);
    return {
      enabled: true,
      link: {
        ...rest,
        isPrimary: links[0]?.userId === ctx.userId,
        needsRelink: needsDiscordRelink(syncError),
        sibling: sibling ? (sibling.user?.username ?? sibling.userId) : null,
      },
    };
  }),
  /**
   * Make the signed-in character the primary of its Discord account: the server nickname,
   * village role and Linked Roles metadata follow it.
   */
  setPrimary: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      if (!isDiscordLinkingEnabled())
        return errorResponse("Discord linking is disabled");
      const link = await findDiscordLinkForSetPrimary(ctx.drizzle, ctx);
      if (!link) return errorResponse("No Discord account is linked");
      if (link.isPrimary) return errorResponse("This character is already primary");
      await setDiscordPrimary(ctx.drizzle, link);
      await logDiscordAction(ctx.drizzle, {
        actorUserId: ctx.userId,
        targetUserId: ctx.userId,
        message: `Set as primary for Discord ${link.discordUsername}`,
        changes: [`Discord: ${link.discordUsername} (${link.discordId})`],
      });
      scheduleDiscordSync(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: "Your Discord nickname and village role now follow this character.",
      };
    }),
  /** Unlink the signed-in character's Discord account. */
  unlink: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    if (!isDiscordLinkingEnabled()) return errorResponse("Discord linking is disabled");
    const [link, sanction] = await Promise.all([
      findDiscordLinkForUnlink(ctx.drizzle, ctx),
      fetchIndefiniteSanction(ctx.drizzle, ctx.userId),
    ]);
    if (!link) return errorResponse("No Discord account is linked");
    // The link carries the Discord ban; keep it while the sanction runs.
    if (sanction)
      return errorResponse(
        "Your Discord link cannot be removed while you are sanctioned",
      );
    const removed = await removeDiscordLink(ctx.drizzle, {
      userId: ctx.userId,
      reason: "USER",
      actorUserId: ctx.userId,
    });
    if (!removed) return errorResponse("No Discord account is linked");
    return {
      success: true,
      message: `Discord unlinked. Linking a different Discord account is possible in ${DISCORD_UNLINK_COOLDOWN_DAYS} days.`,
    };
  }),
  /**
   * Staff: find links by character name, Discord id or Discord username. A match brings
   * every character linked to the same Discord account, grouped together, primary first.
   */
  searchLinks: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(191) }))
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canViewDiscordLinks(user.role))
        throw serverError("FORBIDDEN", "You cannot view Discord links");
      const pattern = `%${input.query.replace(/[%_\\]/g, "\\$&")}%`;
      const [matches, history] = await Promise.all([
        selectDistinctDiscordLinkForSearchLinks(ctx.drizzle, pattern, input),
        selectDiscordLinkHistoryForSearchLinks(ctx.drizzle, pattern, input),
      ]);
      // Depends on the matched Discord ids.
      const links = matches.length
        ? await selectDiscordLinkForSearchLinks(ctx.drizzle, matches)
        : [];
      const logs = await Promise.all(
        links.map((link) => fetchDiscordActionLog(ctx.drizzle, link.userId)),
      );
      return {
        links: links.map((link, index) => {
          const account = links.filter((entry) => entry.discordId === link.discordId);
          return {
            ...link,
            // Same resolution as the sync: the first of the account's links is primary.
            isPrimary: account[0]?.userId === link.userId,
            sameOwner: account
              .filter((entry) => entry.userId !== link.userId)
              .map((entry) => ({
                userId: entry.userId,
                username: entry.username ?? entry.userId,
              })),
            scopes: describeScopes(link.scopes),
            log: logs[index] ?? [],
          };
        }),
        history,
      };
    }),
  /** Staff: remove a character's link, optionally waiving the cooldown. */
  forceUnlink: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().trim().min(3).max(150),
        waiveCooldown: z.boolean(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!isDiscordLinkingEnabled())
        return errorResponse("Discord linking is disabled");
      if (!canManageDiscordLinks(user.role))
        return errorResponse("You cannot remove Discord links");
      const removed = await removeDiscordLink(ctx.drizzle, {
        userId: input.userId,
        reason: "STAFF",
        actorUserId: ctx.userId,
        staffNote: input.reason,
        cooldownWaived: input.waiveCooldown,
      });
      if (!removed) return errorResponse("This character has no Discord link");
      return { success: true, message: "Discord link removed" };
    }),
  /** Staff: re-apply nickname, roles, ban state and metadata now. */
  resync: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!isDiscordLinkingEnabled())
        return errorResponse("Discord linking is disabled");
      if (!canManageDiscordLinks(user.role))
        return errorResponse("You cannot resync Discord links");
      const result = await syncDiscordMember(ctx.drizzle, input.userId, {
        force: true,
      });
      await logDiscordAction(ctx.drizzle, {
        actorUserId: ctx.userId,
        targetUserId: input.userId,
        message: "Staff resynced Discord",
        changes: result.errors.length ? result.errors : ["Synced"],
      });
      if (!result.synced)
        return errorResponse(`Discord sync incomplete: ${result.errors.join("; ")}`);
      return { success: true, message: "Discord state re-applied" };
    }),
});
