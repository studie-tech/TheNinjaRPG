import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  FACTION_RAID_COST,
  FACTION_RAID_DAILY_DRAIN,
  FACTION_RAID_MIN_MEMBERS,
  FACTION_RAID_REWARD,
  OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS,
  OBJECTIVE_WAR_DEFEAT_PENALTY_DAYS,
  OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS,
  VILLAGE_SYNDICATE_ID,
  WAR_ATTACKER_EXHAUSTION_MULTIPLIER,
  WAR_DECLARATION_COST,
  WAR_DEFEAT_STRUCTURE_PENALTY_DAYS,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_OBJECTIVES_PER_SIDE,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_VICTORY_STRUCTURE_BOOST_DAYS,
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_BOOST_DAYS,
  WAR_WINNING_COOLDOWN_DAYS,
  type WarState,
  type WarType,
} from "@/drizzle/constants";
import { mpvpBattleQueue, type War, war, warAlly } from "@/drizzle/schema";
import { selectWarObjectives } from "@/libs/objectiveWar";
import {
  getRaidDeclarationBlock,
  isFactionVillage,
  isVillageInvolvedInAnyWar,
  shouldEndRaid,
} from "@/libs/war";
import { incrementNotificationCounters } from "@/queries/misc";
import { findSectorByNumber } from "@/queries/shrine";
import {
  deleteMpvpBattleQueueForFinishWarSettlement,
  deleteUserRequestForFinishWarSettlement,
  executeClaimedForHandleWarEnd,
  executeRowsForFinishWarSettlement,
  executeRowsForFinishWarSettlement2,
  executeRowsForFinishWarSettlement3,
  executeRowsForFinishWarSettlement4,
  executeRowsForFinishWarSettlement5,
  executeRowsForFinishWarSettlement6,
  fetchSettlementWar,
  insertGameSettingForFinishWarSettlement,
  insertNotificationForFinishWarSettlement,
  insertNotificationForStartDeclaredWar,
  insertSectorForStartSectorWar,
  insertWarForStartDeclaredWar,
  insertWarForStartSectorWar,
  listGameSettingForFinishWarSettlement,
  listSectorForStartDeclaredWar,
  listWarForHandleWarEnd,
  listWarForResumePendingWarSettlements,
  listWarForStartDeclaredWar,
  listWarForStartSectorWar,
  selectClanMemberCountForVillage,
  selectVillageForStartSectorWar,
  selectVillageStructureForStartDeclaredWar,
  updateUserDataForFinishWarSettlement,
  updateUserDataForFinishWarSettlement2,
  updateVillageElderVoteForStartApprovedVoteWar,
  updateVillageForStartDeclaredWar,
  updateVillageForStartSectorWar,
  updateWarForApplyRaidHealthDecay,
  updateWarForFinishWarSettlement,
  updateWarMercenaryForFinishWarSettlement,
} from "@/queries/war";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { type DrizzleClient, drizzleDB } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchWarRules, settleObjectiveWarSchedule } from "@/server/utils/objectiveWar";
import { notifyWarVillages } from "@/server/utils/push/war";
import { logError } from "@/server/utils/sentry";
import { DAY_S, secondsFromDate } from "@/utils/time";
import type { WarSettlement } from "@/validators/war";

/** Close a war and change balances in one guarded statement; finish durable delivery receipts afterward. */
export const handleWarEnd = async (
  activeWar: FetchActiveWarsReturnType,
  client: DrizzleClient = drizzleDB,
  options: {
    losingVillageId?: string;
    shrineBuilderId?: string;
    resolveByHealth?: boolean;
  } = {},
): Promise<FetchActiveWarsReturnType> => {
  let current = activeWar;
  if (
    current.rules &&
    !current.endedAt &&
    current.combatStartedAt &&
    (Date.now() >=
      current.combatStartedAt.getTime() + current.rules.durationDays * DAY_S * 1000 ||
      Date.now() >= current.lastTokenReductionAt.getTime() + DAY_S * 1000)
  ) {
    await settleObjectiveWarSchedule(client, current);
    current = (await fetchSettlementWar(client, current.id)) ?? current;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (current.status !== "ACTIVE" || current.endedAt) {
      await finishWarSettlement(client, current);
      return current;
    }
    if (
      options.shrineBuilderId &&
      (current.type !== "SECTOR_WAR" ||
        current.defenderShrineHp > 0 ||
        current.attackerVillage.kageId !== options.shrineBuilderId ||
        current.attackerVillage.tokens < WAR_PURCHASE_SHRINE_TOKEN_COST)
    )
      return current;

    const now = new Date();
    const deadline =
      current.rules && current.combatStartedAt
        ? current.combatStartedAt.getTime() + current.rules.durationDays * DAY_S * 1000
        : now.getTime();
    const endedAt = new Date(Math.min(now.getTime(), deadline));
    const isRaid = current.type === "WAR_RAID";
    const canSurrenderRaid = isRaid && !shouldEndRaid(current, endedAt);
    const losingVillageId =
      !isRaid || canSurrenderRaid ? options.losingVillageId : undefined;
    if (isRaid && !losingVillageId && !shouldEndRaid(current, endedAt)) return current;
    if (
      !isRaid &&
      !options.losingVillageId &&
      !options.shrineBuilderId &&
      !options.resolveByHealth &&
      !(
        current.rules &&
        current.combatStartedAt &&
        Date.now() >=
          current.combatStartedAt.getTime() + current.rules.durationDays * DAY_S * 1000
      ) &&
      (current.rules || current.attackerVillage.tokens > 0) &&
      (current.rules || current.defenderVillage.tokens > 0) &&
      current.attackerWarHealth > 0 &&
      current.defenderWarHealth > 0
    )
      return current;

    const isSector = current.type === "SECTOR_WAR";
    const attackerLost =
      losingVillageId === current.attackerVillageId ||
      (!isRaid && !current.rules && current.attackerVillage.tokens <= 0) ||
      current.attackerWarHealth <= 0;
    const defenderLost =
      !!options.shrineBuilderId ||
      losingVillageId === current.defenderVillageId ||
      (!isRaid && !current.rules && current.defenderVillage.tokens <= 0) ||
      current.defenderWarHealth <= 0;
    const isDraw =
      !isRaid &&
      ((attackerLost && defenderLost) ||
        (!attackerLost &&
          !defenderLost &&
          current.attackerWarHealth === current.defenderWarHealth));
    const winnerId = isRaid
      ? defenderLost && !attackerLost
        ? current.attackerVillageId
        : current.defenderVillageId
      : (attackerLost && !defenderLost) ||
          (!attackerLost &&
            !defenderLost &&
            current.attackerWarHealth < current.defenderWarHealth)
        ? current.defenderVillageId
        : current.attackerVillageId;
    const loserId =
      winnerId === current.attackerVillageId
        ? current.defenderVillageId
        : current.attackerVillageId;
    const status: WarState = isDraw
      ? "DRAW"
      : winnerId === current.attackerVillageId
        ? "ATTACKER_VICTORY"
        : "DEFENDER_VICTORY";
    const winningVillageIds = isRaid
      ? [winnerId]
      : isDraw
        ? []
        : [
            ...new Set([
              winnerId,
              ...current.warAllies
                .filter((ally) => ally.supportVillageId === winnerId)
                .map((ally) => ally.villageId),
            ]),
          ].sort();
    const share = isRaid
      ? winnerId === current.attackerVillageId
        ? FACTION_RAID_REWARD
        : 0
      : winningVillageIds.length
        ? Math.floor(WAR_VICTORY_TOKEN_BONUS / winningVillageIds.length)
        : 0;
    const winnerTokens =
      share +
      (!isRaid && winningVillageIds.length
        ? WAR_VICTORY_TOKEN_BONUS % winningVillageIds.length
        : 0);
    const sectorWars = isSector ? await listWarForHandleWarEnd(client, current) : [];
    const villageIds = [
      ...new Set([
        current.attackerVillageId,
        current.defenderVillageId,
        ...current.warAllies.map((ally) => ally.villageId),
        ...sectorWars.flatMap((other) => [
          other.attackerVillageId,
          other.defenderVillageId,
          ...other.warAllies.map((ally) => ally.villageId),
        ]),
      ]),
    ];
    const winnerName =
      winnerId === current.attackerVillageId
        ? current.attackerVillage.name
        : current.defenderVillage.name;
    const settlement: WarSettlement = {
      villageIds,
      winningVillageIds,
      warIds: [...new Set([current.id, ...sectorWars.map((other) => other.id)])],
      notificationContent: isRaid
        ? `Raid between ${current.attackerVillage.name} and ${current.defenderVillage.name} has ended. ${winnerName} receives the structure raid bonus.${winnerTokens ? ` The attacking faction receives ${winnerTokens.toLocaleString()} tokens.` : ""}`
        : isSector
          ? `Sector ${current.sector} has been claimed by ${winnerName}. `
          : `War between ${current.attackerVillage.name} and ${current.defenderVillage.name} has ended. ${isDraw ? "The result was a draw." : `${winnerName} won the war and received ${winnerTokens} tokens. `}`,
      boostsDelivered: isRaid || isSector || isDraw,
      structuresDelivered: isRaid || isSector,
      notified: false,
    };
    const attackerCooldown = current.rules
      ? secondsFromDate(
          (status === "ATTACKER_VICTORY"
            ? WAR_WINNING_COOLDOWN_DAYS
            : OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS) * DAY_S,
          endedAt,
        )
      : secondsFromDate(
          (status === "ATTACKER_VICTORY"
            ? WAR_WINNING_COOLDOWN_DAYS
            : WAR_LOSING_COOLDOWN_DAYS) *
            DAY_S *
            WAR_ATTACKER_EXHAUSTION_MULTIPLIER,
          endedAt,
        );
    const defenderCooldown = current.rules
      ? secondsFromDate(
          (status === "DEFENDER_VICTORY"
            ? WAR_WINNING_COOLDOWN_DAYS
            : OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS) * DAY_S,
          endedAt,
        )
      : secondsFromDate(
          (status === "DEFENDER_VICTORY"
            ? WAR_WINNING_COOLDOWN_DAYS
            : WAR_LOSING_COOLDOWN_DAYS) * DAY_S,
          endedAt,
        );

    const membership = alias(warAlly, "wa");

    const rosterMatches = current.warAllies.length
      ? sql.join(
          current.warAllies.map(
            (ally) =>
              sql`(${membership.villageId} = ${ally.villageId} AND ${membership.supportVillageId} = ${ally.supportVillageId})`,
          ),
          sql` OR `,
        )
      : sql`FALSE`;

    // Drizzle cannot update multiple tables. This follows purchase delivery's atomic
    // receipt/balance write: failed or duplicate claims cannot lose or repeat value.
    // SYSDATE freezes cleanup when the write runs, including time spent waiting on locks.
    const claimed = await retryOnDeadlock(() =>
      executeClaimedForHandleWarEnd(
        client,
        villageIds,
        isSector,
        loserId,
        sectorWars,
        settlement,
        isRaid,
        current,
        status,
        endedAt,
        options,
        winningVillageIds,
        winnerId,
        winnerTokens,
        share,
        attackerCooldown,
        defenderCooldown,
        losingVillageId,

        rosterMatches,
      ),
    );
    if (claimed.rowsAffected > 0) {
      current = { ...current, status, endedAt, settlement, settlementPending: true };
      notifyWarVillages(client, settlement.villageIds, current.id);
      const saved = await fetchSettlementWar(client, current.id).catch((error) => {
        logError(error, "Failed to load war settlement receipt", { warId: current.id });
      });
      if (saved) {
        current = saved;
        await finishWarSettlement(client, current);
      }
      return current;
    }
    const saved = await fetchSettlementWar(client, current.id);
    if (!saved) throw new Error("War no longer exists");
    current = saved;
  }
  if (options.shrineBuilderId) return current;
  throw new Error("War changed while settling; retry with its current state");
};

/** Resume delivery independently of daily war decay. */
export const resumePendingWarSettlements = async (client: DrizzleClient) => {
  const pending = await listWarForResumePendingWarSettlements(client);
  await Promise.all(pending.map((endedWar) => finishWarSettlement(client, endedWar)));
};

/** Every effect is repeatable or coupled to its own receipt in one statement. */
const finishWarSettlement = async (client: DrizzleClient, endedWar: War) => {
  const receipt = endedWar.settlement;
  if (!receipt || !endedWar.endedAt || !endedWar.settlementPending) return;
  const endedAt = endedWar.endedAt;
  const cleanupCutoff = new Date(receipt.cleanupCutoff ?? endedAt.getTime());
  const winningIds = receipt.winningVillageIds;
  const isSector = endedWar.type === "SECTOR_WAR";
  const isDraw = endedWar.status === "DRAW";
  const winnerId =
    endedWar.status === "DEFENDER_VICTORY"
      ? endedWar.defenderVillageId
      : endedWar.attackerVillageId;
  const loserId =
    winnerId === endedWar.attackerVillageId
      ? endedWar.defenderVillageId
      : endedWar.attackerVillageId;
  const trainBoostNames = (endedWar.rules ? winningIds : [winnerId]).map(
    (id) => `war-${id}-train`,
  );
  const boostNames = [...winningIds.map((id) => `war-${id}-regen`), ...trainBoostNames];
  const boostEnd = secondsFromDate(WAR_WINNING_BOOST_DAYS * DAY_S, endedAt);
  const structureEnd = secondsFromDate(
    WAR_VICTORY_STRUCTURE_BOOST_DAYS * DAY_S,
    endedAt,
  );
  const penaltyEnd = secondsFromDate(
    (endedWar.rules
      ? OBJECTIVE_WAR_DEFEAT_PENALTY_DAYS
      : WAR_DEFEAT_STRUCTURE_PENALTY_DAYS) * DAY_S,
    endedAt,
  );
  const stepGuard = (
    key: "boostsDelivered" | "structuresDelivered" | "notified",
  ) => sql`
    ${war.id} = ${endedWar.id} AND ${war.settlementPending} = TRUE
    AND JSON_UNQUOTE(JSON_EXTRACT(${war.settlement}, ${`$.${key}`})) = 'false'`;

  const queueMatch = and(
    eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
    isNull(mpvpBattleQueue.battleId),
    lte(mpvpBattleQueue.createdAt, cleanupCutoff),
    isSector
      ? eq(mpvpBattleQueue.sector, endedWar.sector)
      : or(
          inArray(mpvpBattleQueue.attackerEntityId, receipt.villageIds),
          inArray(mpvpBattleQueue.defenderEntityId, receipt.villageIds),
        ),
  );
  try {
    if (!receipt.boostsDelivered) {
      const existing = await listGameSettingForFinishWarSettlement(client, boostNames);
      const missing = boostNames.filter(
        (name) => !existing.some((row) => row.name === name),
      );
      if (missing.length)
        await insertGameSettingForFinishWarSettlement(client, missing);
    }
    await Promise.all([
      updateWarMercenaryForFinishWarSettlement(client, endedAt, endedWar),
      endedWar.rules
        ? updateUserDataForFinishWarSettlement(client, endedWar)
        : Promise.resolve(),
      !receipt.boostsDelivered
        ? retryOnDeadlock(() =>
            executeRowsForFinishWarSettlement(
              client,
              boostNames,
              trainBoostNames,
              boostEnd,
              stepGuard,
            ),
          )
        : Promise.resolve(),
      !receipt.structuresDelivered
        ? retryOnDeadlock(() =>
            executeRowsForFinishWarSettlement2(
              client,
              loserId,
              endedWar,
              isDraw,
              winningIds,
              winnerId,
              endedAt,
              penaltyEnd,
              structureEnd,

              stepGuard,
            ),
          )
        : Promise.resolve(),
      retryOnDeadlock(() =>
        insertNotificationForFinishWarSettlement(client, endedWar, receipt),
      ),
      retryOnDeadlock(() =>
        deleteUserRequestForFinishWarSettlement(client, cleanupCutoff, receipt),
      ),
      retryOnDeadlock(() =>
        executeRowsForFinishWarSettlement3(client, cleanupCutoff, receipt),
      ),
    ]);
    // The feed entry is durable before its count receipt is claimed; retries never increment twice.
    if (!receipt.notified)
      await retryOnDeadlock(() =>
        executeRowsForFinishWarSettlement4(client, endedWar, stepGuard),
      );
    await Promise.all([
      retryOnDeadlock(() => updateUserDataForFinishWarSettlement2(client, receipt)),
      retryOnDeadlock(() => executeRowsForFinishWarSettlement5(client, queueMatch)),
    ]);
    // Wake users while their membership rows exist, then remove memberships before the queue.
    await retryOnDeadlock(() => executeRowsForFinishWarSettlement6(client, queueMatch));
    await retryOnDeadlock(() =>
      deleteMpvpBattleQueueForFinishWarSettlement(client, queueMatch),
    );
    await retryOnDeadlock(() => updateWarForFinishWarSettlement(client, endedWar));
    endedWar.settlementPending = false;
  } catch (error) {
    // Balances and the terminal outcome have committed. Reads and the hourly job retry
    // pending delivery; callers keep their success response rather than paying again.
    logError(error, "Failed to finish war settlement delivery", { warId: endedWar.id });
  }
};

/**
 * Serialize sector declarations with objective selection and charge only committed wars.
 * A transaction is required because the guarded charge, new war and optional sector
 * span separate rows; village locks also exclude concurrent objective declarations.
 */
export const startSectorWar = async (
  client: DrizzleClient,
  declaration: {
    id: string;
    attackerVillageId: string;
    defenderVillageId: string;
    initiatedByUserId: string;
    sectorId: number;
  },
) =>
  retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      // Share declaration/settlement locks so objective selection cannot race a new sector war.
      const villageIds = [
        declaration.attackerVillageId,
        declaration.defenderVillageId,
      ].sort();
      const lockedVillages = await selectVillageForStartSectorWar(tx, villageIds);
      const attacker = lockedVillages.find(
        (v) => v.id === declaration.attackerVillageId,
      );
      if (
        lockedVillages.length !== 2 ||
        attacker?.kageId !== declaration.initiatedByUserId
      )
        return false;
      // A transaction holds a single connection; its queries must run sequentially.
      const activeWars = await listWarForStartSectorWar(tx);
      const targetSector = await findSectorByNumber(tx, declaration.sectorId);
      if (
        (targetSector?.villageId ?? VILLAGE_SYNDICATE_ID) !==
          declaration.defenderVillageId ||
        (targetSector &&
          attacker.warExhaustionEndedAt &&
          attacker.warExhaustionEndedAt > new Date()) ||
        villageIds.some((id) =>
          isVillageInvolvedInAnyWar(activeWars, id, undefined, [
            "VILLAGE_WAR",
            "WAR_RAID",
          ]),
        ) ||
        activeWars.some(
          (w) =>
            w.type === "SECTOR_WAR" &&
            (w.attackerVillageId === attacker.id ||
              w.defenderVillageId === attacker.id),
        )
      )
        return false;
      const charge = await updateVillageForStartSectorWar(tx, attacker);
      if (charge.rowsAffected === 0) return false;
      await insertWarForStartSectorWar(tx, declaration, attacker, targetSector);
      if (!targetSector) await insertSectorForStartSectorWar(tx, declaration);
      return true;
    }),
  );

/**
 * Start an approved declaration only while both villages remain available and the
 * attacker can afford it. The token charge and war commit together; leaders are
 * notified after success. Rejected declarations leave tokens and wars unchanged.
 */
export const startDeclaredWar = async (
  client: DrizzleClient,
  declaration: {
    attackerVillageId: string;
    attackerVillageName: string;
    defenderVillageId: string;
    defenderVillageName: string;
    defenderKageId?: string | null;
    initiatedByUserId: string;
    warType: WarType;
    targetStructureRoute: string;
  },
) => {
  const configuredRules =
    declaration.warType === "VILLAGE_WAR" ? await fetchWarRules(client) : null;
  const rules = configuredRules?.enabled ? configuredRules : null;
  const warId = nanoid();
  const started = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      // Lock settlements before any consistent read so a waiting declaration sees the preceding commit. Sorted locks avoid inversion.
      const villageIds = [
        declaration.attackerVillageId,
        declaration.defenderVillageId,
      ].sort();
      const lockedVillages = await selectVillageForStartSectorWar(tx, villageIds);
      if (lockedVillages.length !== 2) return false;

      // A transaction holds a single connection; its queries must run sequentially.
      const activeWars = await listWarForStartDeclaredWar(tx, rules);
      const sectors = rules ? await listSectorForStartDeclaredWar(tx, villageIds) : [];
      if (
        villageIds.some((id) =>
          isVillageInvolvedInAnyWar(
            activeWars.filter((w) => w.type !== "SECTOR_WAR"),
            id,
          ),
        )
      )
        return false;

      const isRaid = declaration.warType === "WAR_RAID";
      const cost = isRaid
        ? FACTION_RAID_COST
        : (rules?.declarationCost ?? WAR_DECLARATION_COST);
      const now = new Date();
      const combatStartedAt = rules
        ? secondsFromDate(rules.noticeHours * 3600, now)
        : null;
      const objectives = rules
        ? lockedVillages.flatMap((v) =>
            selectWarObjectives(
              sectors,
              v.id,
              v.sector,
              rules,
              Math.random,
              activeWars.filter((w) => w.type === "SECTOR_WAR").map((w) => w.sector),
            ),
          )
        : [];
      if (rules && objectives.length !== WAR_OBJECTIVES_PER_SIDE * 2) return false;
      if (isRaid) {
        const attacker = lockedVillages.find(
          (v) => v.id === declaration.attackerVillageId,
        )!;
        const defender = lockedVillages.find(
          (v) => v.id === declaration.defenderVillageId,
        )!;
        if (
          !isFactionVillage(attacker) ||
          attacker.kageId !== declaration.initiatedByUserId ||
          !["VILLAGE", "HIDEOUT", "STRONGHOLD"].includes(defender.type)
        )
          return false;
        const [members] = await selectClanMemberCountForVillage(tx, attacker.id);
        const structures = await selectVillageStructureForStartDeclaredWar(
          tx,
          villageIds,
        );
        if (
          (members?.count ?? 0) < FACTION_RAID_MIN_MEMBERS ||
          getRaidDeclarationBlock(
            attacker,
            structures.filter((s) => s.villageId === attacker.id),
            structures.filter((s) => s.villageId === defender.id),
            defender.id,
            declaration.targetStructureRoute,
          )
        )
          return false;
      }
      const tokenResult = await updateVillageForStartDeclaredWar(tx, cost, declaration);
      if (tokenResult.rowsAffected === 0) return false;

      await insertWarForStartDeclaredWar(
        tx,
        warId,
        declaration,
        rules,
        combatStartedAt,
        objectives,
        isRaid,
      );
      return true;
    }),
  );
  if (!started) return false;

  notifyWarVillages(
    client,
    [declaration.attackerVillageId, declaration.defenderVillageId],
    warId,
  );

  const warContent = `${declaration.attackerVillageName} has declared ${declaration.warType === "WAR_RAID" ? "a raid" : "war"} on ${declaration.defenderVillageName}!`;
  const notifyKageIds = [declaration.initiatedByUserId];
  if (declaration.defenderKageId) notifyKageIds.push(declaration.defenderKageId);
  try {
    await Promise.all([
      insertNotificationForStartDeclaredWar(
        client,
        declaration.initiatedByUserId,
        warContent,
      ),
      incrementNotificationCounters(client, notifyKageIds),
    ]);
  } catch (error) {
    // The war has committed; keep the client's success response and war refresh intact.
    logError(error, "Failed to notify leaders about a started war", {
      attackerVillageId: declaration.attackerVillageId,
      defenderVillageId: declaration.defenderVillageId,
    });
  }
  return true;
};

/**
 * Start the war for an elder vote that was already claimed as APPROVED. If the start
 * throws, the claim is released back to PENDING so the vote never shows APPROVED
 * without a war; the hourly resolver retries it once the voting window ends.
 */
export const startApprovedVoteWar = async (
  client: DrizzleClient,
  voteId: string,
  declaration: Parameters<typeof startDeclaredWar>[1],
) => {
  try {
    return await startDeclaredWar(client, declaration);
  } catch (error) {
    await updateVillageElderVoteForStartApprovedVoteWar(client, voteId);
    throw error;
  }
};

/** A timestamp CAS makes retries of a daily raid drain harmless. Treasury tokens are unaffected. */
export const applyRaidHealthDecay = async (
  client: DrizzleClient,
  raid: FetchActiveWarsReturnType,
  now = new Date(),
) => {
  const intervals = Math.floor(
    (now.getTime() - raid.lastTokenReductionAt.getTime()) / (DAY_S * 1000),
  );
  if (raid.type !== "WAR_RAID" || intervals <= 0) return;
  const drain = intervals * FACTION_RAID_DAILY_DRAIN;
  const result = await updateWarForApplyRaidHealthDecay(client, drain, raid, intervals);
  if (
    result.rowsAffected > 0 &&
    (raid.attackerWarHealth <= drain || raid.defenderWarHealth <= drain)
  )
    await handleWarEnd(
      {
        ...raid,
        attackerWarHealth: Math.max(0, raid.attackerWarHealth - drain),
        defenderWarHealth: Math.max(0, raid.defenderWarHealth - drain),
      },
      client,
    );
};
