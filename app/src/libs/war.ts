import { drizzleDB } from "@/server/db";
import { war, village, villageStructure, userRequest } from "@/drizzle/schema";
import { userData, notification, gameSetting, sector } from "@/drizzle/schema";
import { eq, and, or, ne } from "drizzle-orm";
import { sql, inArray, notInArray } from "drizzle-orm";
import {
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_BOOST_DAYS,
  WAR_WINNING_BOOST_REGEN_PERC,
  WAR_WINNING_BOOST_TRAINING_PERC,
  SHRINE_HP_BY_LEVEL,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_WINNING_COOLDOWN_DAYS,
  WAR_VICTORY_STRUCTURE_BOOST_LEVELS,
  WAR_VICTORY_STRUCTURE_BOOST_DAYS,
  WAR_VICTORY_BOOSTED_STRUCTURES,
  WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
  WAR_DEFEAT_STRUCTURE_PENALTY_DAYS,
  WAR_SECTOR_LOSS_TOWNHALL_DAMAGE,
} from "@/drizzle/constants";
import { getUnique } from "@/utils/grouping";
import type { WarState } from "@/drizzle/constants";
import { TERR_BOT_ID } from "@/drizzle/constants";
import { findRelationship } from "@/utils/alliance";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import type { BattleWar } from "@/libs/combat/types";
import { secondsFromNow, secondsFromDate, DAY_S } from "@/utils/time";

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
    const attackerVillageIds = [
      w.attackerVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.attackerVillageId)
        .map((wa) => wa.villageId),
    ];
    const defenderVillageIds = [
      w.defenderVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.defenderVillageId)
        .map((wa) => wa.villageId),
    ];
    const check1 =
      attackerVillageIds.includes(targetVillageId ?? "") &&
      defenderVillageIds.includes(userVillageId ?? "");
    const check2 =
      defenderVillageIds.includes(targetVillageId ?? "") &&
      attackerVillageIds.includes(userVillageId ?? "");
    return check1 || check2;
  });
};

/**
 * Checks if two users are war allies
 * @param targetWars - The wars to check
 * @param userWars - The wars to check
 * @param targetVillageId - The village ID to check
 * @param userVillageId - The village ID to check
 * @returns The war if found, otherwise undefined
 */
export const findWarAllies = (
  targetWars: BattleWar[],
  userWars: BattleWar[],
  targetVillageId: string | null | undefined,
  userVillageId: string | null | undefined,
) => {
  return getUnique([...targetWars, ...userWars], "id").filter((w) => {
    const attackerVillageIds = [
      w.attackerVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.attackerVillageId)
        .map((wa) => wa.villageId),
    ];
    const defenderVillageIds = [
      w.defenderVillageId,
      ...w.warAllies
        .filter((wa) => wa.supportVillageId === w.defenderVillageId)
        .map((wa) => wa.villageId),
    ];
    const check1 =
      attackerVillageIds.includes(targetVillageId ?? "") &&
      attackerVillageIds.includes(userVillageId ?? "");
    const check2 =
      defenderVillageIds.includes(targetVillageId ?? "") &&
      defenderVillageIds.includes(userVillageId ?? "");
    return check1 || check2;
  });
};

/**
 * Checks if two users are war allies
 * @param wars - The wars to check
 * @param targetVillageId - The village ID to check
 * @param userVillageId - The village ID to check
 * @returns Whether the users are war allies
 */
export const isWarAllies = (
  wars: BattleWar[] | null | undefined,
  targetVillageId: string | null | undefined,
  userVillageId: string | null | undefined,
) => {
  if (!wars) return false;
  return findWarAllies(wars, wars, targetVillageId, userVillageId).length > 0;
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
  const losingCooldownEnd = secondsFromDate(WAR_LOSING_COOLDOWN_DAYS * DAY_S, endedAt);
  const winningCooldownEnd = secondsFromDate(
    WAR_WINNING_COOLDOWN_DAYS * DAY_S,
    endedAt,
  );
  const boostEndAt = secondsFromNow(WAR_WINNING_BOOST_DAYS * DAY_S);

  // Check if war should end based on tokens OR war health
  // War ends when either side's tokens OR war health reaches 0
  const attackerLost =
    activeWar.attackerVillage.tokens <= 0 || activeWar.attackerWarHealth <= 0;
  const defenderLost =
    activeWar.defenderVillage.tokens <= 0 || activeWar.defenderWarHealth <= 0;

  // Determine winner - handles normal end (tokens/health <= 0) and 14-day auto-resolution
  let isDraw = false;
  let winnerVillageId: string;
  let loserVillageId: string;

  if (attackerLost && defenderLost) {
    // Both sides lost simultaneously - draw
    isDraw = true;
    winnerVillageId = activeWar.attackerVillage.id;
    loserVillageId = activeWar.defenderVillage.id;
  } else if (attackerLost) {
    // Attacker lost
    winnerVillageId = activeWar.defenderVillage.id;
    loserVillageId = activeWar.attackerVillage.id;
  } else if (defenderLost) {
    // Defender lost
    winnerVillageId = activeWar.attackerVillage.id;
    loserVillageId = activeWar.defenderVillage.id;
  } else {
    // Neither side lost (14-day auto-resolution) - determine winner by war health
    if (activeWar.attackerWarHealth === activeWar.defenderWarHealth) {
      // Equal health - draw
      isDraw = true;
      winnerVillageId = activeWar.attackerVillage.id;
      loserVillageId = activeWar.defenderVillage.id;
    } else if (activeWar.attackerWarHealth > activeWar.defenderWarHealth) {
      // Attacker has more health - attacker wins
      winnerVillageId = activeWar.attackerVillage.id;
      loserVillageId = activeWar.defenderVillage.id;
    } else {
      // Defender has more health - defender wins
      winnerVillageId = activeWar.defenderVillage.id;
      loserVillageId = activeWar.attackerVillage.id;
    }
  }

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
          // Update sector ownership
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
          // End other wars for this sector
          drizzleDB
            .update(war)
            .set({ status: "DEFENDER_VICTORY", endedAt })
            .where(and(ne(war.id, activeWar.id), eq(war.sector, activeWar.sector))),
          // Damage loser's townhall when losing a sector
          drizzleDB
            .update(villageStructure)
            .set({
              curSp: sql`GREATEST(curSp - ${WAR_SECTOR_LOSS_TOWNHALL_DAMAGE}, 0)`,
            })
            .where(
              and(
                eq(villageStructure.villageId, loserVillageId),
                eq(villageStructure.route, "/townhall"),
              ),
            ),
        ]
      : []),
    // Handle village wars
    ...(["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)
      ? isDraw
        ? [
            drizzleDB
              .update(village)
              .set({
                warExhaustionEndedAt: losingCooldownEnd,
                lastWarEndedAt: endedAt,
              })
              .where(inArray(village.id, [loserVillageId, winnerVillageId])),
            // Enhanced punishment: -3 temporary levels on structures for both sides in a draw
            // VILLAGE_WAR: ALL structures, WAR_RAID: only targeted structure
            drizzleDB
              .update(villageStructure)
              .set({
                temporaryLevelBonus: -WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
                temporaryLevelBonusExpiresAt: secondsFromDate(
                  WAR_DEFEAT_STRUCTURE_PENALTY_DAYS * DAY_S,
                  endedAt,
                ),
              })
              .where(
                activeWar.type === "WAR_RAID"
                  ? and(
                      inArray(villageStructure.villageId, [
                        loserVillageId,
                        winnerVillageId,
                      ]),
                      eq(villageStructure.route, activeWar.targetStructureRoute),
                    )
                  : inArray(villageStructure.villageId, [
                      loserVillageId,
                      winnerVillageId,
                    ]),
              ),
          ]
        : [
            // Winner gets tokens
            drizzleDB
              .update(village)
              .set({
                tokens: sql`tokens + ${winningPoints}`,
              })
              .where(inArray(village.id, [...winningAllies, winnerVillageId])),
            // Winner gets regen boost
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
            // Winner gets training boost
            drizzleDB
              .update(gameSetting)
              .set({
                value: WAR_WINNING_BOOST_TRAINING_PERC,
                time: boostEndAt,
              })
              .where(eq(gameSetting.name, `war-${winnerVillageId}-train`)),
            // Enhanced rewards: +3 temporary levels on specific structures for winner
            drizzleDB
              .update(villageStructure)
              .set({
                temporaryLevelBonus: WAR_VICTORY_STRUCTURE_BOOST_LEVELS,
                temporaryLevelBonusExpiresAt: secondsFromDate(
                  WAR_VICTORY_STRUCTURE_BOOST_DAYS * DAY_S,
                  endedAt,
                ),
              })
              .where(
                and(
                  eq(villageStructure.villageId, winnerVillageId),
                  inArray(
                    villageStructure.route,
                    WAR_VICTORY_BOOSTED_STRUCTURES as unknown as string[],
                  ),
                ),
              ),
            // Loser gets war exhaustion
            drizzleDB
              .update(village)
              .set({
                warExhaustionEndedAt: losingCooldownEnd,
                lastWarEndedAt: endedAt,
              })
              .where(eq(village.id, loserVillageId)),
            // Winner gets shorter exhaustion
            drizzleDB
              .update(village)
              .set({
                warExhaustionEndedAt: winningCooldownEnd,
                lastWarEndedAt: endedAt,
              })
              .where(eq(village.id, winnerVillageId)),
            // Enhanced punishment: -3 temporary levels on structures for loser
            // VILLAGE_WAR: ALL structures, WAR_RAID: only targeted structure
            drizzleDB
              .update(villageStructure)
              .set({
                temporaryLevelBonus: -WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
                temporaryLevelBonusExpiresAt: secondsFromDate(
                  WAR_DEFEAT_STRUCTURE_PENALTY_DAYS * DAY_S,
                  endedAt,
                ),
              })
              .where(
                activeWar.type === "WAR_RAID"
                  ? and(
                      eq(villageStructure.villageId, loserVillageId),
                      eq(villageStructure.route, activeWar.targetStructureRoute),
                    )
                  : eq(villageStructure.villageId, loserVillageId),
              ),
          ]
      : []),
  ]);

  // Clean up incomplete war quests for users in villages involved in this war
  // Run separately after other operations to avoid deadlock (this query joins QuestHistory with UserData)
  // Daily cron will reassign if they're still in another war
  await drizzleDB.execute(sql`
    DELETE qh FROM QuestHistory qh
    INNER JOIN UserData ud ON qh.userId = ud.userId
    WHERE qh.questType = 'war'
      AND qh.completed = 0
      AND ud.villageId IN (${sql.join(
        [
          activeWar.attackerVillageId,
          activeWar.defenderVillageId,
          ...activeWar.warAllies.map((a) => a.villageId),
        ].map((id) => sql`${id}`),
        sql`, `,
      )})
  `);

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

/**
 * Checks if a village is involved in any active war (as attacker, defender, or ally)
 * @param activeWars - Array of active wars to check against
 * @param villageId - The village ID to check
 * @param excludeWarId - Optional war ID to exclude from the check
 * @returns true if the village is involved in any active war, false otherwise
 */
export const isVillageInvolvedInAnyWar = (
  activeWars: FetchActiveWarsReturnType[],
  villageId: string,
  excludeWarId?: string,
): boolean => {
  return activeWars.some((war) => {
    // Skip the excluded war if provided
    if (excludeWarId && war.id === excludeWarId) {
      return false;
    }

    // Check if village is attacker or defender
    if (war.attackerVillageId === villageId || war.defenderVillageId === villageId) {
      return true;
    }

    // Check if village is an ally in the war
    return war.warAllies.some((ally) => ally.villageId === villageId);
  });
};
