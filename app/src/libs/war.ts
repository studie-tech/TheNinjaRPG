import { drizzleDB } from "@/server/db";
import { war, village, villageStructure, userRequest } from "@/drizzle/schema";
import { userData, notification, gameSetting, sector } from "@/drizzle/schema";
import { eq, and, or, ne } from "drizzle-orm";
import { sql, inArray, notInArray } from "drizzle-orm";
import {
  WAR_EXHAUSTION_DURATION_DAYS,
  WAR_STRUCTURE_UPGRADE_BLOCK_DAYS,
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_BOOST_DAYS,
  WAR_WINNING_BOOST_REGEN_PERC,
  WAR_WINNING_BOOST_TRAINING_PERC,
  SHRINE_HP_BY_LEVEL,
} from "@/drizzle/constants";
import { getUnique } from "@/utils/grouping";
import type { WarState } from "@/drizzle/constants";
import { TERR_BOT_ID } from "@/drizzle/constants";
import { findRelationship } from "@/utils/alliance";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import type { BattleWar } from "@/libs/combat/types";
import { secondsFromNow } from "@/utils/time";

/**
 * Convenience method which checks target wars, and sees if the user village ID is in the war.
 * Returns the given war if found, otherwise undefined.
 * @param targetWars - The wars to check
 * @param targetVillageId - The village ID to check
 * @param userVillageId - The village ID of the user
 * @returns The war if found, otherwise undefined
 */
export const findWarsWithUser = (
  targetWars: BattleWar[],
  userWars: BattleWar[],
  targetVillageId: string | null | undefined,
  userVillageId: string | null | undefined,
) => {
  return getUnique([...targetWars, ...userWars], "id").filter((w) => {
    // Check if the user is in the war
    const check1 =
      w.attackerVillageId === userVillageId && w.defenderVillageId === targetVillageId;
    const check2 =
      w.defenderVillageId === userVillageId && w.attackerVillageId === targetVillageId;
    // Check if the user is an ally of the war
    const check3 =
      targetVillageId &&
      [w.attackerVillageId, w.defenderVillageId].includes(targetVillageId) &&
      w.warAllies.some(
        (wa) =>
          wa.villageId === userVillageId && wa.supportVillageId !== targetVillageId,
      );
    const check4 =
      userVillageId &&
      [w.attackerVillageId, w.defenderVillageId].includes(userVillageId) &&
      w.warAllies.some(
        (wa) =>
          wa.villageId === targetVillageId && wa.supportVillageId !== userVillageId,
      );

    // Return true if any of the checks are true
    return check1 || check2 || check3 || check4;
  });
};

/**
 * Resets the wartime townhalls
 * @param activeWars - The active wars
 */
export const resetStructuresWhenNotInWar = async (
  activeWars: FetchActiveWarsReturnType[],
) => {
  const villagesInWars = activeWars.flatMap((war) => [
    war.attackerVillageId,
    war.defenderVillageId,
  ]);
  await drizzleDB
    .update(villageStructure)
    .set({ curSp: sql`maxSp` })
    .where(
      villagesInWars.length > 0
        ? notInArray(villageStructure.villageId, villagesInWars)
        : undefined,
    );
};

/**
 * Checks if a village can join a war
 * @param activeWar - The war to check
 * @param relationships - The relationships between villages
 * @param joiningVillage - The village to join the war
 * @param warringVillage - The village to war against
 * @returns Whether the village can join the war and a message
 */
export const canJoinWar = (
  activeWar: FetchActiveWarsReturnType,
  relationships: VillageAlliance[],
  joiningVillage: Village,
  warringVillage: Village,
) => {
  // Derived
  const joiningVillageId = joiningVillage.id;
  const warringVillageId = warringVillage.id;
  const relationship = findRelationship(
    relationships,
    joiningVillageId,
    warringVillageId,
  );
  const status = relationship?.status || "NEUTRAL";
  // Checks
  const check1 = ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
    joiningVillageId,
  );
  const check2 = [activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
    warringVillageId,
  );
  const check3 = !activeWar.warAllies.some((f) => f.villageId === joiningVillageId);
  const check4 = ["VILLAGE", "HIDEOUT", "TOWN"].includes(joiningVillage.type);
  const check5 = ["NEUTRAL", "ALLY"].includes(status);
  const check6 = joiningVillage.type !== "VILLAGE" || joiningVillage.allianceSystem;
  const check = check1 && check2 && check3 && check4 && check5 && check6;
  // Derived message for each check failing
  let message = "";
  if (!check1) message = "Cannot join war, already in it";
  if (!check2) message = "Cannot join war, warring village is not in it";
  if (!check3) message = "Cannot join war, faction already in war";
  if (!check4) message = "Cannot join war, not a village/hideout/town";
  if (!check5) message = "Cannot join war with your enemy";
  if (!check6) message = "Cannot join war, not a joinable village/hideout/town";
  // Return
  return { check, message };
};

/**
 * Handles the end of a war. Assumes the village with tokens <= 0 is the loser.
 * @param war - The war to handle
 * @returns
 */
export const handleWarEnd = async (activeWar: FetchActiveWarsReturnType) => {
  // Timer calculations
  const endedAt = new Date();
  const warExhaustionEnd = new Date(
    endedAt.getTime() + WAR_EXHAUSTION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );
  const structureUpgradeBlock = new Date(
    endedAt.getTime() + WAR_STRUCTURE_UPGRADE_BLOCK_DAYS * 24 * 60 * 60 * 1000,
  );
  const boostEndAt = secondsFromNow(WAR_WINNING_BOOST_DAYS * 24 * 60 * 60);

  // If both villages have >= 0 tokens, just return without ending
  if (activeWar.attackerVillage.tokens > 0 && activeWar.defenderVillage.tokens > 0) {
    return activeWar;
  }

  // Get IDs of villages & factions that lost (less than 0 tokens) and won (more than 0 tokens)
  // Note both villages could be losing if they both got their points deducted simultaneously
  const isDraw =
    activeWar.attackerVillage.tokens <= 0 && activeWar.defenderVillage.tokens <= 0;
  const winnerVillageId =
    activeWar.attackerVillage.tokens > 0
      ? activeWar.attackerVillage.id
      : activeWar.defenderVillage.id;
  const loserVillageId =
    winnerVillageId === activeWar.attackerVillage.id
      ? activeWar.defenderVillage.id
      : activeWar.attackerVillage.id;
  const status: WarState = isDraw
    ? "DRAW"
    : winnerVillageId === activeWar.attackerVillage.id
      ? "ATTACKER_VICTORY"
      : "DEFENDER_VICTORY";

  // Calculate winning tokens
  let winningPoints = isDraw ? 0 : WAR_VICTORY_TOKEN_BONUS;
  let winningAllies: string[] = [];
  if (!isDraw && winnerVillageId && activeWar.warAllies.length > 0) {
    winningAllies = activeWar.warAllies
      .filter((f) => f.villageId === winnerVillageId)
      .map((f) => f.villageId);
    winningPoints = WAR_VICTORY_TOKEN_BONUS / (winningAllies.length + 1);
  }

  let notificationContent = "";
  if (["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
    notificationContent = `War between ${activeWar.attackerVillage.name} and ${activeWar.defenderVillage.name} has ended. `;
    if (isDraw) {
      notificationContent += `The result was a draw.`;
    } else if (status === "ATTACKER_VICTORY") {
      notificationContent += `${activeWar.attackerVillage.name} won the war and received ${winningPoints} tokens. `;
    } else {
      notificationContent += `${activeWar.defenderVillage.name} won the war and received ${winningPoints} tokens. `;
    }
  } else if (activeWar.type === "SECTOR_WAR" && status === "ATTACKER_VICTORY") {
    notificationContent = `Sector ${activeWar.sector} has been claimed by ${activeWar.attackerVillage.name}. `;
  }
  // Run updates
  await Promise.all([
    // General updates
    drizzleDB.update(war).set({ status, endedAt }).where(eq(war.id, activeWar.id)),
    drizzleDB.insert(notification).values({
      userId: TERR_BOT_ID,
      content: notificationContent,
    }),
    drizzleDB
      .update(userData)
      .set({ unreadNotifications: sql`unreadNotifications + 1` })
      .where(inArray(userData.villageId, [loserVillageId, winnerVillageId])),
    drizzleDB
      .delete(userRequest)
      .where(
        and(
          eq(userRequest.type, "WAR_ALLY"),
          or(
            inArray(userRequest.senderId, [
              activeWar.attackerVillage.kageId,
              activeWar.defenderVillage.kageId,
            ]),
            inArray(userRequest.receiverId, [
              activeWar.attackerVillage.kageId,
              activeWar.defenderVillage.kageId,
            ]),
          ),
        ),
      ),
    // Handle sector wars
    ...(activeWar.type === "SECTOR_WAR"
      ? [
          drizzleDB
            .update(sector)
            .set({
              villageId: winnerVillageId,
              shrineLevel: 1,
              capturedAt: endedAt,
            })
            .where(
              and(
                eq(sector.sector, activeWar.sector),
                ne(sector.villageId, winnerVillageId),
              ),
            ),
          drizzleDB
            .update(war)
            .set({ status: "DEFENDER_VICTORY", endedAt })
            .where(and(ne(war.id, activeWar.id), eq(war.sector, activeWar.sector))),
        ]
      : []),
    // Handle village wars
    ...(["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)
      ? isDraw
        ? [
            drizzleDB
              .update(village)
              .set({
                warExhaustionEndedAt: warExhaustionEnd,
                lastWarEndedAt: endedAt,
              })
              .where(inArray(village.id, [loserVillageId, winnerVillageId])),
            drizzleDB
              .update(villageStructure)
              .set({
                level: sql`GREATEST(level - 1, 1)`,
                lastUpgradedAt: structureUpgradeBlock,
              })
              .where(
                and(
                  inArray(villageStructure.villageId, [
                    loserVillageId,
                    winnerVillageId,
                  ]),
                  eq(villageStructure.route, activeWar.targetStructureRoute),
                ),
              ),
          ]
        : [
            drizzleDB
              .update(village)
              .set({
                tokens: sql`tokens + ${winningPoints}`,
              })
              .where(inArray(village.id, [...winningAllies, winnerVillageId])),
            drizzleDB
              .update(gameSetting)
              .set({
                value: WAR_WINNING_BOOST_REGEN_PERC,
                time: boostEndAt,
              })
              .where(
                inArray(
                  gameSetting.name,
                  [...winningAllies, winnerVillageId].map((id) => `war-${id}-regen`),
                ),
              ),
            drizzleDB
              .update(gameSetting)
              .set({
                value: WAR_WINNING_BOOST_TRAINING_PERC,
                time: boostEndAt,
              })
              .where(eq(gameSetting.name, `war-${winnerVillageId}-train`)),
            drizzleDB
              .update(village)
              .set({
                warExhaustionEndedAt: warExhaustionEnd,
                lastWarEndedAt: endedAt,
              })
              .where(eq(village.id, loserVillageId)),
            drizzleDB
              .update(villageStructure)
              .set({
                level: sql`GREATEST(level - 1, 1)`,
                lastUpgradedAt: structureUpgradeBlock,
              })
              .where(
                and(
                  eq(villageStructure.villageId, loserVillageId),
                  ...(activeWar.type === "WAR_RAID"
                    ? [eq(villageStructure.route, activeWar.targetStructureRoute)]
                    : []),
                ),
              ),
          ]
      : []),
  ]);

  // Return updated war
  return { ...activeWar, status, endedAt } as FetchActiveWarsReturnType;
};

/**
 * Get the shrine hp for a given level
 * @param level - The level of the shrine
 * @returns The shrine hp
 */
export const getShrineHpByLevel = (level?: number | null) => {
  const idx = (
    [1, 2, 3].includes(level || 1) ? level : 1
  ) as keyof typeof SHRINE_HP_BY_LEVEL;
  return SHRINE_HP_BY_LEVEL[idx];
};
