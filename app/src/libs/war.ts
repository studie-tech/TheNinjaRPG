import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { WarState, WarType } from "@/drizzle/constants";
import {
  BRACKET_IMMUNITY_LIFT_SECS,
  SHRINE_HP_BY_LEVEL,
  TERR_BOT_ID,
  WAR_ATTACKER_EXHAUSTION_MULTIPLIER,
  WAR_DEFEAT_STRUCTURE_PENALTY_DAYS,
  WAR_DEFEAT_STRUCTURE_PENALTY_LEVELS,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_PARTICIPANT_SECS,
  WAR_SECTOR_LOSS_TOWNHALL_DAMAGE,
  WAR_VICTORY_BOOSTED_STRUCTURES,
  WAR_VICTORY_STRUCTURE_BOOST_DAYS,
  WAR_VICTORY_STRUCTURE_BOOST_LEVELS,
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_BOOST_DAYS,
  WAR_WINNING_BOOST_REGEN_PERC,
  WAR_WINNING_BOOST_TRAINING_PERC,
  WAR_WINNING_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import {
  gameSetting,
  mpvpBattleQueue,
  notification,
  sector,
  userData,
  userRequest,
  village,
  villageStructure,
  war,
} from "@/drizzle/schema";
import type { BattleWar } from "@/libs/combat/types";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { type DrizzleClient, drizzleDB } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { findRelationship } from "@/utils/alliance";
import { getUnique } from "@/utils/grouping";
import { DAY_S, secondsFromDate, secondsFromNow } from "@/utils/time";

/**
 * SQL fragment that extends `userData.warParticipantUntil` to the larger of its current
 * value and `NOW() + WAR_PARTICIPANT_SECS`, so an existing longer stamp is never shortened.
 */
export const extendWarParticipantSql = () =>
  sql`GREATEST(${userData.warParticipantUntil}, NOW() + INTERVAL ${WAR_PARTICIPANT_SECS} SECOND)`;

/**
 * SQL fragment that lifts `userData.bracketImmunityLiftedUntil` to the larger of its current
 * value and `NOW() + BRACKET_IMMUNITY_LIFT_SECS`, so an existing longer lift is never shortened.
 */
export const liftBracketImmunitySql = () =>
  sql`GREATEST(${userData.bracketImmunityLiftedUntil}, NOW() + INTERVAL ${BRACKET_IMMUNITY_LIFT_SECS} SECOND)`;

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

type HandleWarEndOptions = {
  client?: DrizzleClient;
  /** Reuse an already-open transaction so a caller can commit its receipt atomically. */
  transaction?: DrizzleClient;
  /** Reject a caller whose complete mutable War snapshot is no longer current. */
  expectedWarState?: FetchActiveWarsReturnType;
  /** Administrative/product flows may intentionally choose the loser without changing tokens. */
  forcedLoserVillageId?: string;
  /** A purchase which must succeed in the same transaction before the war can end. */
  villageTokenSpend?: {
    villageId: string;
    amount: number;
  };
  /** Hourly decay values that must commit atomically with the terminal outcome. */
  preparedState?: {
    attackerTokens: number;
    defenderTokens: number;
    attackerWarHealth: number;
    defenderWarHealth: number;
  };
  /** Max-duration resolution compares remaining health even though neither side is exhausted. */
  resolveByRemainingHealth?: boolean;
};

const affectedRows = (result: unknown): number => {
  if (Array.isArray(result)) return affectedRows(result[0]);
  if (!result || typeof result !== "object") return 0;
  if ("rowsAffected" in result && typeof result.rowsAffected === "number") {
    return result.rowsAffected;
  }
  if ("affectedRows" in result && typeof result.affectedRows === "number") {
    return result.affectedRows;
  }
  return 0;
};

const sameWarRowState = (
  current: FetchActiveWarsReturnType,
  expected: FetchActiveWarsReturnType,
) =>
  current.attackerVillageId === expected.attackerVillageId &&
  current.defenderVillageId === expected.defenderVillageId &&
  current.startedAt.getTime() === expected.startedAt.getTime() &&
  (current.endedAt?.getTime() ?? null) === (expected.endedAt?.getTime() ?? null) &&
  current.status === expected.status &&
  current.type === expected.type &&
  current.sector === expected.sector &&
  current.attackerShrineHp === expected.attackerShrineHp &&
  current.attackerShrineMaxHp === expected.attackerShrineMaxHp &&
  current.attackerShrineStatus === expected.attackerShrineStatus &&
  current.defenderShrineHp === expected.defenderShrineHp &&
  current.defenderShrineMaxHp === expected.defenderShrineMaxHp &&
  current.defenderShrineStatus === expected.defenderShrineStatus &&
  current.lastTokenReductionAt.getTime() === expected.lastTokenReductionAt.getTime() &&
  current.targetStructureRoute === expected.targetStructureRoute &&
  current.attackerWarHealth === expected.attackerWarHealth &&
  current.defenderWarHealth === expected.defenderWarHealth &&
  current.attackerWarHealthMax === expected.attackerWarHealthMax &&
  current.defenderWarHealthMax === expected.defenderWarHealthMax;

class RollbackWarEndPreparation extends Error {}

const isRollbackWarEndPreparation = (error: unknown): boolean => {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof RollbackWarEndPreparation) return true;
    current = current.cause;
  }
  return false;
};

/**
 * Resolve an active war through one War-row lock and one transaction. A stale caller whose war
 * was already administratively deleted/ended returns without applying any rewards or cleanup.
 */
export const handleWarEnd = async (
  staleWar: FetchActiveWarsReturnType,
  options: HandleWarEndOptions = {},
): Promise<FetchActiveWarsReturnType | undefined> => {
  const client = options.client ?? drizzleDB;
  const resolveInTransaction = async (rawTx: DrizzleClient) => {
    const tx = rawTx as unknown as DrizzleClient;
    let hasPreparatoryWrite = false;
    const noClaim = () => {
      if (hasPreparatoryWrite) throw new RollbackWarEndPreparation();
      return undefined;
    };
    const loadActiveWar = () =>
      tx.query.war.findFirst({
        where: and(
          eq(war.id, staleWar.id),
          eq(war.status, "ACTIVE"),
          isNull(war.endedAt),
        ),
        with: {
          attackerVillage: { with: { structures: true } },
          defenderVillage: { with: { structures: true } },
          warAllies: { with: { village: true } },
        },
      });

    await tx.execute(
      sql`SELECT ${war.id} FROM ${war} WHERE ${war.id} = ${staleWar.id} FOR UPDATE`,
    );
    const activeIdentity = await tx.query.war.findFirst({
      where: and(
        eq(war.id, staleWar.id),
        eq(war.status, "ACTIVE"),
        isNull(war.endedAt),
      ),
      columns: { attackerVillageId: true, defenderVillageId: true },
    });
    if (!activeIdentity) return undefined;
    const participantVillageIds = [
      activeIdentity.attackerVillageId,
      activeIdentity.defenderVillageId,
    ].sort();
    await tx.execute(sql`
          SELECT ${village.id} FROM ${village}
          WHERE ${village.id} IN (${sql.join(
            participantVillageIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          ORDER BY ${village.id} FOR UPDATE
        `);
    let activeWar = await loadActiveWar();
    if (!activeWar?.attackerVillage || !activeWar.defenderVillage) {
      return undefined;
    }

    if (
      options.expectedWarState &&
      !sameWarRowState(activeWar, options.expectedWarState)
    ) {
      return undefined;
    }

    if (
      options.forcedLoserVillageId &&
      ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
        options.forcedLoserVillageId,
      )
    ) {
      return undefined;
    }
    if (
      options.villageTokenSpend &&
      ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
        options.villageTokenSpend.villageId,
      )
    ) {
      return undefined;
    }
    if (
      options.villageTokenSpend &&
      (!options.forcedLoserVillageId || options.villageTokenSpend.amount <= 0)
    ) {
      return undefined;
    }
    if (options.villageTokenSpend && !sameWarRowState(activeWar, staleWar)) {
      return undefined;
    }

    if (options.villageTokenSpend) {
      const spend = await tx
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${options.villageTokenSpend.amount}`,
        })
        .where(
          and(
            eq(village.id, options.villageTokenSpend.villageId),
            gte(village.tokens, options.villageTokenSpend.amount),
          ),
        );
      if (affectedRows(spend) !== 1) return undefined;
      hasPreparatoryWrite = true;
      const purchasedWar = await loadActiveWar();
      if (!purchasedWar?.attackerVillage || !purchasedWar.defenderVillage) {
        return noClaim();
      }
      activeWar = purchasedWar;
    }

    if (options.preparedState) {
      if (
        options.preparedState.attackerTokens > 0 &&
        options.preparedState.defenderTokens > 0 &&
        options.preparedState.attackerWarHealth > 0 &&
        options.preparedState.defenderWarHealth > 0
      ) {
        return undefined;
      }
      if (
        !sameWarRowState(activeWar, staleWar) ||
        activeWar.attackerVillage.tokens !== staleWar.attackerVillage.tokens ||
        activeWar.defenderVillage.tokens !== staleWar.defenderVillage.tokens
      ) {
        return undefined;
      }
      await tx
        .update(war)
        .set({
          attackerWarHealth: options.preparedState.attackerWarHealth,
          defenderWarHealth: options.preparedState.defenderWarHealth,
        })
        .where(
          and(eq(war.id, activeWar.id), eq(war.status, "ACTIVE"), isNull(war.endedAt)),
        );
      hasPreparatoryWrite = true;
      await tx
        .update(village)
        .set({ tokens: options.preparedState.attackerTokens })
        .where(eq(village.id, activeWar.attackerVillageId));
      await tx
        .update(village)
        .set({ tokens: options.preparedState.defenderTokens })
        .where(eq(village.id, activeWar.defenderVillageId));
      const preparedWar = await loadActiveWar();
      if (!preparedWar?.attackerVillage || !preparedWar.defenderVillage) {
        return noClaim();
      }
      activeWar = preparedWar;
    }

    const forcedLoserVillageId = options.forcedLoserVillageId;

    const endedAt = new Date();
    const losingCooldownEnd = secondsFromDate(
      WAR_LOSING_COOLDOWN_DAYS * DAY_S,
      endedAt,
    );
    const winningCooldownEnd = secondsFromDate(
      WAR_WINNING_COOLDOWN_DAYS * DAY_S,
      endedAt,
    );
    const attackerLosingCooldownEnd = secondsFromDate(
      Math.round(WAR_LOSING_COOLDOWN_DAYS * WAR_ATTACKER_EXHAUSTION_MULTIPLIER * DAY_S),
      endedAt,
    );
    const attackerWinningCooldownEnd = secondsFromDate(
      Math.round(
        WAR_WINNING_COOLDOWN_DAYS * WAR_ATTACKER_EXHAUSTION_MULTIPLIER * DAY_S,
      ),
      endedAt,
    );
    const boostEndAt = secondsFromNow(WAR_WINNING_BOOST_DAYS * DAY_S);
    const involvedVillageIds = [
      activeWar.attackerVillageId,
      activeWar.defenderVillageId,
      ...activeWar.warAllies.map((ally) => ally.villageId),
    ];

    const attackerLost =
      forcedLoserVillageId === activeWar.attackerVillageId ||
      activeWar.attackerVillage.tokens <= 0 ||
      activeWar.attackerWarHealth <= 0;
    const defenderLost =
      forcedLoserVillageId === activeWar.defenderVillageId ||
      activeWar.defenderVillage.tokens <= 0 ||
      activeWar.defenderWarHealth <= 0;
    if (!attackerLost && !defenderLost && !options.resolveByRemainingHealth) {
      return noClaim();
    }

    let isDraw = false;
    let winnerVillageId: string;
    let loserVillageId: string;
    if (attackerLost && defenderLost) {
      isDraw = true;
      winnerVillageId = activeWar.attackerVillage.id;
      loserVillageId = activeWar.defenderVillage.id;
    } else if (attackerLost) {
      winnerVillageId = activeWar.defenderVillage.id;
      loserVillageId = activeWar.attackerVillage.id;
    } else if (defenderLost) {
      winnerVillageId = activeWar.attackerVillage.id;
      loserVillageId = activeWar.defenderVillage.id;
    } else if (activeWar.attackerWarHealth === activeWar.defenderWarHealth) {
      isDraw = true;
      winnerVillageId = activeWar.attackerVillage.id;
      loserVillageId = activeWar.defenderVillage.id;
    } else if (activeWar.attackerWarHealth > activeWar.defenderWarHealth) {
      winnerVillageId = activeWar.attackerVillage.id;
      loserVillageId = activeWar.defenderVillage.id;
    } else {
      winnerVillageId = activeWar.defenderVillage.id;
      loserVillageId = activeWar.attackerVillage.id;
    }

    const status: WarState = isDraw
      ? "DRAW"
      : winnerVillageId === activeWar.attackerVillage.id
        ? "ATTACKER_VICTORY"
        : "DEFENDER_VICTORY";
    let winningPoints = isDraw ? 0 : WAR_VICTORY_TOKEN_BONUS;
    let winningAllies: string[] = [];
    if (!isDraw && activeWar.warAllies.length > 0) {
      winningAllies = activeWar.warAllies
        .filter((ally) => ally.supportVillageId === winnerVillageId)
        .map((ally) => ally.villageId);
      winningPoints = WAR_VICTORY_TOKEN_BONUS / (winningAllies.length + 1);
    }

    let notificationContent = "";
    if (["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
      notificationContent = `War between ${activeWar.attackerVillage.name} and ${activeWar.defenderVillage.name} has ended. `;
      if (isDraw) notificationContent += "The result was a draw.";
      else if (status === "ATTACKER_VICTORY") {
        notificationContent += `${activeWar.attackerVillage.name} won the war and received ${winningPoints} tokens. `;
      } else {
        notificationContent += `${activeWar.defenderVillage.name} won the war and received ${winningPoints} tokens. `;
      }
    } else if (activeWar.type === "SECTOR_WAR" && status === "ATTACKER_VICTORY") {
      notificationContent = `Sector ${activeWar.sector} has been claimed by ${activeWar.attackerVillage.name}. `;
    }

    // This guarded transition is the claim gate. No side effect below runs unless this exact
    // active row was transitioned by this transaction.
    const transition = await tx
      .update(war)
      .set({ status, endedAt })
      .where(
        and(eq(war.id, activeWar.id), eq(war.status, "ACTIVE"), isNull(war.endedAt)),
      );
    if (affectedRows(transition) !== 1) return noClaim();

    await tx
      .update(userData)
      .set({ warParticipantUntil: new Date(0) })
      .where(
        and(
          inArray(userData.villageId, involvedVillageIds),
          sql`NOT EXISTS (
            SELECT 1 FROM War w
            WHERE w.endedAt IS NULL
              AND w.id != ${activeWar.id}
              AND (w.attackerVillageId = ${userData.villageId} OR w.defenderVillageId = ${userData.villageId})
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM WarAlly wa
            INNER JOIN War w ON wa.warId = w.id
            WHERE w.endedAt IS NULL
              AND w.id != ${activeWar.id}
              AND wa.villageId = ${userData.villageId}
          )`,
        ),
      );
    if (notificationContent) {
      await tx.insert(notification).values({
        userId: TERR_BOT_ID,
        content: notificationContent,
      });
      await tx
        .update(userData)
        .set({ unreadNotifications: sql`unreadNotifications + 1` })
        .where(inArray(userData.villageId, [loserVillageId, winnerVillageId]));
    }
    await tx
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
      );

    if (activeWar.type === "SECTOR_WAR") {
      if (status === "ATTACKER_VICTORY") {
        await tx
          .update(sector)
          .set({ villageId: winnerVillageId, shrineLevel: 1, capturedAt: endedAt })
          .where(
            and(
              eq(sector.sector, activeWar.sector),
              ne(sector.villageId, winnerVillageId),
            ),
          );
        await tx
          .update(villageStructure)
          .set({
            curSp: sql`GREATEST(curSp - ${WAR_SECTOR_LOSS_TOWNHALL_DAMAGE}, 0)`,
          })
          .where(
            and(
              eq(villageStructure.villageId, loserVillageId),
              eq(villageStructure.route, "/townhall"),
            ),
          );
      }
      await tx
        .update(war)
        .set({ status: "DEFENDER_VICTORY", endedAt })
        .where(
          and(
            ne(war.id, activeWar.id),
            eq(war.sector, activeWar.sector),
            isNull(war.endedAt),
          ),
        );
    } else if (["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
      if (isDraw) {
        await tx
          .update(village)
          .set({
            warExhaustionEndedAt: attackerLosingCooldownEnd,
            lastWarEndedAt: endedAt,
          })
          .where(eq(village.id, activeWar.attackerVillage.id));
        await tx
          .update(village)
          .set({ warExhaustionEndedAt: losingCooldownEnd, lastWarEndedAt: endedAt })
          .where(eq(village.id, activeWar.defenderVillage.id));
        await tx
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
              : inArray(villageStructure.villageId, [loserVillageId, winnerVillageId]),
          );
      } else {
        await tx
          .update(village)
          .set({ tokens: sql`tokens + ${winningPoints}` })
          .where(inArray(village.id, [...winningAllies, winnerVillageId]));
        await tx
          .update(gameSetting)
          .set({ value: WAR_WINNING_BOOST_REGEN_PERC, time: boostEndAt })
          .where(
            inArray(
              gameSetting.name,
              [...winningAllies, winnerVillageId].map((id) => `war-${id}-regen`),
            ),
          );
        await tx
          .update(gameSetting)
          .set({ value: WAR_WINNING_BOOST_TRAINING_PERC, time: boostEndAt })
          .where(eq(gameSetting.name, `war-${winnerVillageId}-train`));
        await tx
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
          );
        await tx
          .update(village)
          .set({
            warExhaustionEndedAt:
              loserVillageId === activeWar.attackerVillage.id
                ? attackerLosingCooldownEnd
                : losingCooldownEnd,
            lastWarEndedAt: endedAt,
          })
          .where(eq(village.id, loserVillageId));
        await tx
          .update(village)
          .set({
            warExhaustionEndedAt:
              winnerVillageId === activeWar.attackerVillage.id
                ? attackerWinningCooldownEnd
                : winningCooldownEnd,
            lastWarEndedAt: endedAt,
          })
          .where(eq(village.id, winnerVillageId));
        await tx
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
          );
      }
    }

    await tx.execute(sql`
      DELETE qh FROM QuestHistory qh
      INNER JOIN UserData ud ON qh.userId = ud.userId
      WHERE qh.questType = 'war'
        AND qh.completed = 0
        AND ud.villageId IN (${sql.join(
          involvedVillageIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);
    if (activeWar.type === "SECTOR_WAR" && activeWar.sector) {
      await tx.execute(sql`
        UPDATE UserData ud
        INNER JOIN MpvpBattleUser mbu ON ud.userId = mbu.userId
        INNER JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
        SET ud.status = 'AWAKE'
        WHERE mbq.battleType = 'SHRINE_BATTLE'
          AND mbq.sector = ${activeWar.sector}
          AND mbq.battleId IS NULL
          AND ud.status = 'QUEUED'
      `);
      await tx.execute(sql`
        DELETE mbu FROM MpvpBattleUser mbu
        INNER JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
        WHERE mbq.battleType = 'SHRINE_BATTLE'
          AND mbq.sector = ${activeWar.sector}
          AND mbq.battleId IS NULL
      `);
      await tx
        .delete(mpvpBattleQueue)
        .where(
          and(
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
            eq(mpvpBattleQueue.sector, activeWar.sector),
            isNull(mpvpBattleQueue.battleId),
          ),
        );
    } else if (["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
      await tx.execute(sql`
        UPDATE UserData ud
        INNER JOIN MpvpBattleUser mbu ON ud.userId = mbu.userId
        INNER JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
        SET ud.status = 'AWAKE'
        WHERE mbq.battleType = 'SHRINE_BATTLE'
          AND mbq.battleId IS NULL
          AND (
            mbq.attackerEntityId IN (${sql.join(
              involvedVillageIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            OR mbq.defenderEntityId IN (${sql.join(
              involvedVillageIds.map((id) => sql`${id}`),
              sql`, `,
            )})
          )
          AND ud.status = 'QUEUED'
      `);
      await tx.execute(sql`
        DELETE mbu FROM MpvpBattleUser mbu
        INNER JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
        WHERE mbq.battleType = 'SHRINE_BATTLE'
          AND mbq.battleId IS NULL
          AND (
            mbq.attackerEntityId IN (${sql.join(
              involvedVillageIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            OR mbq.defenderEntityId IN (${sql.join(
              involvedVillageIds.map((id) => sql`${id}`),
              sql`, `,
            )})
          )
      `);
      await tx
        .delete(mpvpBattleQueue)
        .where(
          and(
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
            isNull(mpvpBattleQueue.battleId),
            or(
              inArray(mpvpBattleQueue.attackerEntityId, involvedVillageIds),
              inArray(mpvpBattleQueue.defenderEntityId, involvedVillageIds),
            ),
          ),
        );
    }

    return { ...activeWar, status, endedAt } as FetchActiveWarsReturnType;
  };

  try {
    if (options.transaction) {
      return await resolveInTransaction(options.transaction);
    }
    return await retryOnDeadlock(() =>
      client.transaction((rawTx) =>
        resolveInTransaction(rawTx as unknown as DrizzleClient),
      ),
    );
  } catch (error) {
    if (isRollbackWarEndPreparation(error)) return undefined;
    throw error;
  }
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
 * @param types - Optional array of war types to check for
 * @returns true if the village is involved in any active war, false otherwise
 */
export const isVillageInvolvedInAnyWar = (
  activeWars: FetchActiveWarsReturnType[],
  villageId: string,
  excludeWarId?: string,
  types?: readonly WarType[],
): boolean => {
  return activeWars.some((war) => {
    // Skip the excluded war if provided
    if (excludeWarId && war.id === excludeWarId) {
      return false;
    }

    // Skip if types are provided and war type is not in them
    if (types && !types.includes(war.type)) {
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
