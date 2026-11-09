import { CLAN_ASSASSIN_SLOTS } from "@/drizzle/constants";
import {
  abEvent,
  battleAction,
  dailyBankInterest,
  historicalSoundEffect,
  itemLoadout,
  jutsuReskin,
  parentalControl,
  rankedLoadout,
  recruitmentRewards,
  referralSource,
  sageModeRolls,
  towerDefenseRun,
  userItemVariant,
  userStreakProgress,
  userTowerDefenseUpgrade,
  villageElderVoteEntry,
} from "@/drizzle/schema";
import {
  deleteEmailReminderForRemoveAccountGameData,
  deleteRowsForUser,
  deleteSupportTicketActivityForRemoveAccountGameData,
  deleteSupportTicketActivityForRemoveAccountGameData2,
  deleteSupportTicketForRemoveAccountGameData,
  findAuctionListingForRemoveAccountGameData,
  listSupportTicketForRemoveAccountGameData,
  selectAuctionBidForRemoveAccountGameData,
  updateAnbuSquadForRemoveAccountGameData,
  updateClanForRemoveAccountGameData,
  updateClanForRemoveAccountGameData2,
  updateClanForRemoveAccountGameData3,
  updateSupportTicketForRemoveAccountGameData,
  updateVillageForRemoveAccountGameData,
} from "@/queries/accountDeletion";
import { fetchClan } from "@/queries/clan";
import { findUserById } from "@/queries/profile";
import { removeFromClan } from "@/server/api/routers/clan";
import { drizzleDB } from "@/server/db";
import { deleteUser } from "@/server/utils/accountDeletion/deleteUserData";
import { retireStoreUserId } from "@/server/utils/purchases/storeIdentity";
import { removeAccountProcessorData } from "./processors";

export const removeAccountGameData = async (userId: string) => {
  // Let the normal auction settlement path release escrow; deleting bids or the
  // character first could strand another player's payment or reward.
  const [selling, bidding] = await Promise.all([
    findAuctionListingForRemoveAccountGameData(drizzleDB, userId),
    selectAuctionBidForRemoveAccountGameData(drizzleDB, userId),
  ]);
  if (selling || bidding.length)
    throw new Error("Account deletion awaits auction escrow settlement");
  await retireStoreUserId(drizzleDB, userId);
  await removeAccountProcessorData(userId);
  // Membership is the retry marker: keep departure, leadership transfer and faction
  // teardown atomic so a failed sibling write cannot make the next attempt skip them.
  await drizzleDB.transaction(async (tx) => {
    const user = await findUserById(tx, userId);
    if (user?.clanId) {
      const membership = await fetchClan(tx, user.clanId);
      if (membership)
        await removeFromClan(tx, membership, user, ["Permanent account deletion"]);
    }
  });
  // Only clear roles still owned by this identity. Repeated cleanup must never remove
  // a replacement leader or decrement shared counters a second time.
  await Promise.all([
    updateAnbuSquadForRemoveAccountGameData(drizzleDB, userId),
    updateVillageForRemoveAccountGameData(drizzleDB, userId),
    updateClanForRemoveAccountGameData(drizzleDB, userId),
    updateClanForRemoveAccountGameData2(drizzleDB, userId),
    ...(["coLeader1", "coLeader2", "coLeader3", ...CLAN_ASSASSIN_SLOTS] as const).map(
      (column) => updateClanForRemoveAccountGameData3(drizzleDB, column, userId),
    ),
    deleteEmailReminderForRemoveAccountGameData(drizzleDB, userId),
  ]);
  await Promise.all(
    [
      parentalControl,
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
    ].map((table) => deleteRowsForUser(drizzleDB, table, userId)),
  );
  // deleteUser is the account-scoped cleanup: receipt tombstone, push tokens,
  // conversations, inventory and character. It keeps the purchase ledger so delayed
  // receipts cannot grant rewards again.
  const rejected = await deleteUser(drizzleDB, userId);
  if (rejected) throw new Error(rejected.message);
  // deleteUser (shared with character deletion) leaves support records; permanent account
  // deletion also removes authored support content and releases assigned tickets.
  const tickets = await listSupportTicketForRemoveAccountGameData(drizzleDB, userId);
  if (tickets.length)
    await deleteSupportTicketActivityForRemoveAccountGameData(drizzleDB, tickets);
  await Promise.all([
    deleteSupportTicketActivityForRemoveAccountGameData2(drizzleDB, userId),
    deleteSupportTicketForRemoveAccountGameData(drizzleDB, userId),
    updateSupportTicketForRemoveAccountGameData(drizzleDB, userId),
  ]);
};
