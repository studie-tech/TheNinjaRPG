import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  FACTION_RAID_COST,
  FACTION_RAID_DAILY_DRAIN,
  FACTION_RAID_MIN_MEMBERS,
  OBJECTIVE_WAR_DEFEAT_PENALTY_DAYS,
  VILLAGE_SYNDICATE_ID,
  WAR_DECLARATION_COST,
  WAR_DEFEAT_STRUCTURE_PENALTY_DAYS,
  WAR_OBJECTIVES_PER_SIDE,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_VICTORY_STRUCTURE_BOOST_DAYS,
  WAR_WINNING_BOOST_DAYS,
  type WarType,
} from "@/drizzle/constants";
import { mpvpBattleQueue, type War, war, warAlly } from "@/drizzle/schema";
import { getObjectiveWarDeadline, selectWarObjectives } from "@/libs/objectiveWar";
import {
  computeWarOutcome,
  getRaidDeclarationBlock,
  isFactionVillage,
  isVillageInvolvedInAnyWar,
  shouldEndRaid,
} from "@/libs/war";
import { updateVillageElderVoteForRejectWarDeclaration } from "@/queries/elder";
import { invalidateGameSettings } from "@/queries/gamesettings";
import {
  incrementNotificationCounters,
  insertNotificationForSubmitNotification,
} from "@/queries/misc";
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
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchWarRules, settleObjectiveWarSchedule } from "@/server/utils/objectiveWar";
import { notifyWarVillages } from "@/server/utils/push/war";
import { logError } from "@/server/utils/sentry";
import { DAY_S, secondsFromDate } from "@/utils/time";
import type { WarSettlement } from "@/validators/war";

/** Close a war and change balances in one guarded statement; finish durable delivery receipts afterward. */
export const handleWarEnd = async (
  activeWar: FetchActiveWarsReturnType,
  client: DrizzleClient,
  options: {
    losingVillageId?: string;
    shrineBuilderId?: string;
    resolveByHealth?: boolean;
  } = {},
): Promise<FetchActiveWarsReturnType> => {
  let current = activeWar;
  // Rules and the combat start never change, so the deadline survives the reloads below.
  const combatDeadline =
    activeWar.rules && activeWar.combatStartedAt
      ? getObjectiveWarDeadline(activeWar.combatStartedAt, activeWar.rules)
      : null;
  if (
    combatDeadline !== null &&
    !current.endedAt &&
    (Date.now() >= combatDeadline ||
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
    const endedAt = new Date(Math.min(now.getTime(), combatDeadline ?? now.getTime()));
    const isRaid = current.type === "WAR_RAID";
    const raidEnded = isRaid && shouldEndRaid(current, endedAt);
    const losingVillageId = raidEnded ? undefined : options.losingVillageId;
    if (isRaid && !raidEnded && !losingVillageId) return current;
    if (
      !isRaid &&
      !options.losingVillageId &&
      !options.shrineBuilderId &&
      !options.resolveByHealth &&
      !(combatDeadline !== null && Date.now() >= combatDeadline) &&
      (current.rules || current.attackerVillage.tokens > 0) &&
      (current.rules || current.defenderVillage.tokens > 0) &&
      current.attackerWarHealth > 0 &&
      current.defenderWarHealth > 0
    )
      return current;

    const isSector = current.type === "SECTOR_WAR";
    const {
      isDraw,
      winnerId,
      loserId,
      status,
      winningVillageIds,
      share,
      winnerTokens,
      attackerCooldown,
      defenderCooldown,
    } = computeWarOutcome(current, losingVillageId, options, endedAt);
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
    if (!receipt.boostsDelivered && boostNames.length > 0) {
      await retryOnDeadlock(() =>
        insertGameSettingForFinishWarSettlement(client, boostNames),
      );
    }
    // Finish boost publication and its invalidation before reporting sibling failures.
    const writes = await Promise.allSettled([
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
          ).then(invalidateGameSettings)
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
    const failed = writes.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
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

/**
 * Run a declaration whose vote this caller just claimed as APPROVED: the wars of both
 * villages are checked again, since either may have entered one during the voting window.
 * Anything but a started war cancels the motion and tells its initiator.
 */
export const startClaimedWarDeclaration = async (
  client: DrizzleClient,
  vote: WarDeclarationVote & {
    villageId: string;
    targetId: string;
    warType: Parameters<typeof startDeclaredWar>[1]["warType"] | null;
    targetStructureRoute: string | null;
  },
  {
    attackerVillage,
    defenderVillage,
    activeWars,
  }: {
    attackerVillage: { name: string } | null | undefined;
    defenderVillage: { name: string; kageId: string | null } | undefined;
    activeWars: FetchActiveWarsReturnType[];
  },
) => {
  const defenderName = defenderVillage?.name ?? "another village";
  const cancel = (reason: string) =>
    rejectWarDeclaration(
      client,
      vote,
      `War declaration against ${defenderName} was cancelled — ${reason}.`,
      "APPROVED",
    );
  const warTypes = ["VILLAGE_WAR", "WAR_RAID"] satisfies War["type"][];
  if (
    isVillageInvolvedInAnyWar(activeWars, vote.villageId, undefined, warTypes) ||
    isVillageInvolvedInAnyWar(activeWars, vote.targetId, undefined, warTypes)
  ) {
    await cancel("a village is already involved in an active war");
    return "VILLAGE_IN_WAR";
  }
  if (!attackerVillage) {
    await cancel("the attacking village no longer exists");
    return "ATTACKER_MISSING";
  }
  const started = await startApprovedVoteWar(client, vote.id, {
    attackerVillageId: vote.villageId,
    attackerVillageName: attackerVillage.name,
    defenderVillageId: vote.targetId,
    defenderVillageName: defenderName,
    defenderKageId: defenderVillage?.kageId,
    initiatedByUserId: vote.initiatedByUserId,
    warType: vote.warType ?? "VILLAGE_WAR",
    targetStructureRoute: vote.targetStructureRoute ?? "/townhall",
  });
  if (started) return "STARTED";
  await cancel(
    "a village is already involved in a war or there are no longer enough tokens",
  );
  return "NOT_STARTED";
};

type WarDeclarationVote = {
  id: string;
  endsAt: Date;
  initiatedByUserId: string;
};

/** The feed entry for a declaration the elders voted down. */
export const warDeclarationRejectedMessage = (defenderName: string | undefined) =>
  `War declaration against ${defenderName ?? "another village"} was rejected by the elders.`;

/**
 * Reject a declaration still in `fromStatus` and tell its initiator once. A motion rejected
 * inside its voting window starts its cooldown now, not at the scheduled end.
 */
export const rejectWarDeclaration = async (
  client: DrizzleClient,
  vote: WarDeclarationVote,
  content: string,
  fromStatus: "PENDING" | "APPROVED",
) => {
  const claim = await updateVillageElderVoteForRejectWarDeclaration(
    client,
    vote,
    new Date(Math.min(Date.now(), vote.endsAt.getTime())),
    fromStatus,
  );
  if (claim.rowsAffected > 0)
    await notifyWarDeclarationInitiator(client, vote, content);
};

/** One feed row addressed to the initiator through their unread counter. */
export const notifyWarDeclarationInitiator = (
  client: DrizzleClient,
  vote: { initiatedByUserId: string },
  content: string,
) =>
  Promise.all([
    insertNotificationForSubmitNotification(
      client,
      { userId: vote.initiatedByUserId },
      { content },
    ),
    incrementNotificationCounters(client, [vote.initiatedByUserId]),
  ]);

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
