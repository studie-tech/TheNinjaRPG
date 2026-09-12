import { and, eq, inArray, sql } from "drizzle-orm";
import {
  abEvent,
  anbuSquad,
  auctionBid,
  auctionListing,
  battleAction,
  clan,
  dailyBankInterest,
  emailReminder,
  historicalSoundEffect,
  itemLoadout,
  jutsuReskin,
  rankedLoadout,
  recruitmentRewards,
  referralSource,
  sageModeRolls,
  supportTicket,
  supportTicketActivity,
  towerDefenseRun,
  userData,
  userItemVariant,
  userStreakProgress,
  userTowerDefenseUpgrade,
  village,
  villageElderVoteEntry,
} from "@/drizzle/schema";
import { fetchClan, removeFromClan } from "@/server/api/routers/clan";
import { deleteUser } from "@/server/api/routers/staff";
import { drizzleDB } from "@/server/db";
import { retireStoreUserId } from "@/server/utils/purchases/grant";
import { removeAccountProcessorData } from "./processors";

export const removeAccountGameData = async (userId: string) => {
  // Let the normal auction settlement path release escrow; deleting bids or the
  // character first could strand another player's payment or reward.
  const [selling, bidding] = await Promise.all([
    drizzleDB.query.auctionListing.findFirst({
      columns: { id: true },
      where: and(
        eq(auctionListing.sellerId, userId),
        eq(auctionListing.status, "ACTIVE"),
      ),
    }),
    drizzleDB
      .select({ id: auctionBid.id })
      .from(auctionBid)
      .innerJoin(auctionListing, eq(auctionBid.auctionId, auctionListing.id))
      .where(and(eq(auctionBid.bidderId, userId), eq(auctionListing.status, "ACTIVE")))
      .limit(1),
  ]);
  if (selling || bidding.length)
    throw new Error("Account deletion awaits auction escrow settlement");
  await retireStoreUserId(drizzleDB, userId);
  await removeAccountProcessorData(userId);
  const user = await drizzleDB.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  if (user?.clanId) {
    const membership = await fetchClan(drizzleDB, user.clanId);
    if (membership)
      await removeFromClan(drizzleDB, membership, user, ["Permanent account deletion"]);
  }
  // Only clear roles still owned by this identity. Repeated cleanup must never remove
  // a replacement leader or decrement shared counters a second time.
  await Promise.all([
    drizzleDB
      .update(anbuSquad)
      .set({
        leaderId: sql`(SELECT u.userId FROM UserData u WHERE u.anbuId = ${anbuSquad.id} AND u.userId <> ${userId} ORDER BY u.createdAt LIMIT 1)`,
      })
      .where(eq(anbuSquad.leaderId, userId)),
    drizzleDB.update(village).set({ kageId: "" }).where(eq(village.kageId, userId)),
    drizzleDB.update(clan).set({ leaderId: "" }).where(eq(clan.leaderId, userId)),
    drizzleDB.update(clan).set({ founderId: "" }).where(eq(clan.founderId, userId)),
    ...(
      [
        "coLeader1",
        "coLeader2",
        "coLeader3",
        "assassin1",
        "assassin2",
        "assassin3",
        "assassin4",
        "assassin5",
        "assassin6",
        "assassin7",
        "assassin8",
        "assassin9",
        "assassin10",
      ] as const
    ).map((column) =>
      drizzleDB
        .update(clan)
        .set({ [column]: null })
        .where(eq(clan[column], userId)),
    ),
    drizzleDB.delete(emailReminder).where(eq(emailReminder.userId, userId)),
  ]);
  await Promise.all(
    [
      sageModeRolls,
      historicalSoundEffect,
      userItemVariant,
      jutsuReskin,
      itemLoadout,
      rankedLoadout,
      recruitmentRewards,
      dailyBankInterest,
      villageElderVoteEntry,
      referralSource,
      abEvent,
      userTowerDefenseUpgrade,
      towerDefenseRun,
      userStreakProgress,
      battleAction,
    ].map((table) => drizzleDB.delete(table).where(eq(table.userId, userId))),
  );
  // This is the existing account-scoped cleanup, including the permanent receipt
  // tombstone, push tokens, conversations, inventory and character. It intentionally
  // retains the purchase ledger so delayed receipts cannot grant rewards again.
  await deleteUser(drizzleDB, userId);
  // The old character-reset flow does not remove support records. Permanent account
  // deletion also removes authored support content and releases assigned tickets.
  const tickets = await drizzleDB.query.supportTicket.findMany({
    columns: { id: true },
    where: eq(supportTicket.createdByUserId, userId),
  });
  if (tickets.length)
    await drizzleDB.delete(supportTicketActivity).where(
      inArray(
        supportTicketActivity.ticketId,
        tickets.map((ticket) => ticket.id),
      ),
    );
  await Promise.all([
    drizzleDB
      .delete(supportTicketActivity)
      .where(eq(supportTicketActivity.authorId, userId)),
    drizzleDB.delete(supportTicket).where(eq(supportTicket.createdByUserId, userId)),
    drizzleDB
      .update(supportTicket)
      .set({ assignedToUserId: null })
      .where(eq(supportTicket.assignedToUserId, userId)),
  ]);
};
