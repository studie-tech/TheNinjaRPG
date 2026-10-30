import { count, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  ELDER_MIN_VOTING_COUNT,
  ELDER_WAR_VOTE_HOURS,
  FACTION_RAID_COST,
  FACTION_RAID_MIN_MEMBERS,
  FACTION_RAID_STRUCTURE_ROUTES,
  IMG_AVATAR_DEFAULT,
  MAP_RESERVED_SECTORS,
  SHRINE_MAX_PER_VILLAGE,
  VILLAGE_SYNDICATE_ID,
  WAR_ALLY_MAX_PAYMENT_PERCENTAGE,
  WAR_DECLARATION_COOLDOWN_HOURS,
  WAR_DECLARATION_COST,
  WAR_FACTION_MAX_SECTORS,
  WAR_MERCENARY_LIMIT,
  WAR_MERCENARY_MAX_TOKENS,
  WAR_MINIMUM_MEMBERS_REQUIRED,
  WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
  WAR_MISSION_REQUIRED_RANK,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_VILLAGE_MAX_SECTORS,
} from "@/drizzle/constants";
import {
  type Village,
  type VillageStructure,
  type War,
  type WarAlly,
  warKill,
} from "@/drizzle/schema";
import { castElderVoteEntry, fetchElderVotes } from "@/libs/elder";
import {
  areWarObjectivesRevealed,
  getWarSide,
  isObjectiveWarActive,
  maskWarObjectives,
  withMercenaryParticipation,
} from "@/libs/objectiveWar";
import { isAvailableUserQuests } from "@/libs/quest";
import { findActiveExclusiveRaidForSector } from "@/libs/raids";
import { hasRequiredRank } from "@/libs/train";
import {
  canJoinWar,
  getRaidDeclarationBlock,
  isFactionVillage,
  isVillageInvolvedInAnyWar,
} from "@/libs/war";
import { fetchElderVote } from "@/queries/elder";
import { incrementNotificationCounters } from "@/queries/misc";
import { fetchUser } from "@/queries/profile";
import { fetchQuest, listVisibleRaidQuests } from "@/queries/quests";
import { fetchRequests, insertRequest } from "@/queries/sparring";
import {
  countVillageSectors,
  fetchAlliances,
  fetchSector,
  fetchStructures,
  fetchVillage,
  fetchVillages,
} from "@/queries/village";
import {
  approvePendingWarDeclaration,
  deleteWarAllyForAdminEndWar,
  deleteWarForAdminEndWar,
  deleteWarKillForAdminEndWar,
  executeSavedForConvertWarPoints,
  executeSavedForInviteMercenary,
  executeSavedForLeaveMercenary,
  fetchActiveWar,
  fetchEndedWars,
  findLedVillageId,
  findVillageElderVoteForDeclareVillageWarOrRaid,
  findVillageElderVoteForDeclareVillageWarOrRaid2,
  findVillageForInviteMercenary,
  findVillageForVoteOnWarDeclaration,
  findVillageForVoteOnWarDeclaration2,
  findWarCampForAttackWarCamp,
  findWarForAttackWarCamp,
  findWarForCompleteWarMission,
  findWarForGetMercenaries,
  findWarForGetObjectiveWarInfo,
  findWarForInviteMercenary,
  findWarForStartWarMission,
  insertActionLogForAdminEndWar,
  insertGameSettingForSetRules,
  insertNotificationForCancelWarDeclaration,
  insertNotificationForDeclareSectorWar,
  insertNotificationForDeclareVillageWarOrRaid,
  insertNotificationForVoteOnWarDeclaration,
  insertNotificationForVoteOnWarDeclaration2,
  insertNotificationForVoteOnWarDeclaration3,
  insertNotificationForVoteOnWarDeclaration4,
  insertVillageElderVoteForDeclareVillageWarOrRaid,
  listQuestForGetObjectiveWarInfo,
  listQuestHistoryForGetObjectiveWarInfo,
  listUserDataForDeclareVillageWarOrRaid,
  listWarCampForGetObjectiveWarInfo,
  listWarForFetchActiveWars,
  listWarKillForGetObjectiveWarInfo,
  listWarKillForGetWarKills,
  listWarMercenaryForGetMercenaries,
  listWarMercenaryForGetMercenaryOffers,
  listWarMercenaryForGetObjectiveWarInfo,
  listWarMercenaryForInviteMercenary,
  selectClanMemberCountForVillage,
  selectUserDataForCancelWarDeclaration,
  selectUserDataForGetVillageMemberCount2,
  selectUserDataForVoteOnWarDeclaration,
  selectVillageForGetObjectiveWarInfo,
  selectVillageForGetVillageMemberCount,
  selectWarCampForGetWarCampNotices,
  selectWarContributionForGetObjectiveWarInfo,
  selectWarContributionForGetWarPointClaims,
  selectWarKillForGetWarKillStats,
  updateUserDataForCancelWarMission,
  updateUserDataForClaim,
  updateUserDataForDeclareSectorWar,
  updateUserDataForStartWarMission,
  updateVillageElderVoteForCancelWarDeclaration,
  updateVillageElderVoteForVoteOnWarDeclaration2,
} from "@/queries/war";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser } from "@/routers/profile";
import { fetchRequest } from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { applyObjectiveWarAction, fetchWarRules } from "@/server/utils/objectiveWar";
import { notifyWarVillages } from "@/server/utils/push/war";
import {
  handleWarEnd,
  startApprovedVoteWar,
  startDeclaredWar,
  startSectorWar,
} from "@/server/utils/war";
import {
  acceptWarAllyOffer,
  closeWarAllyOffer,
  withdrawWarAlly,
} from "@/server/utils/warAlly";
import { acceptWarMercenary, fetchMercenaryWarId } from "@/server/utils/warMercenary";
import { findRelationship } from "@/utils/alliance";
import { isKage } from "@/utils/kage";
import {
  canAdministrateWars,
  canModifyCombatSettings,
  canSeeSecretData,
} from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { secondsFromNow } from "@/utils/time";
import { userDeltaResponseSchema } from "@/validators/userCache";
import {
  completeWarMissionSchema,
  declareVillageWarSchema,
  raidOptionsSchema,
  startWarMissionSchema,
  warCampSchema,
  warIdSchema,
  warRulesSchema,
} from "@/validators/war";

export const warRouter = createTRPCRouter({
  /** Return the caller's pending and accepted contracts in open wars, including notice. */
  getMercenaryOffers: protectedProcedure.query(({ ctx }) =>
    listWarMercenaryForGetMercenaryOffers(ctx.drizzle, ctx),
  ),
  /** Return a private unended roster; only the player and employing Kage see each entry. */
  getMercenaries: protectedProcedure
    .input(warIdSchema)
    .query(async ({ ctx, input }) => {
      const [user, activeWar, roster, ledVillage] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findWarForGetMercenaries(ctx.drizzle, input),
        listWarMercenaryForGetMercenaries(ctx.drizzle, input),
        findLedVillageId(ctx.drizzle, ctx.userId),
      ]);
      const canHire =
        !!activeWar?.rules &&
        activeWar.status === "ACTIVE" &&
        !activeWar.endedAt &&
        !!ledVillage &&
        user.villageId === ledVillage.id &&
        [activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          ledVillage.id,
        );
      return {
        canHire: canHire && !user.isBanned,
        roster: roster.filter(
          (m) =>
            m.userId === ctx.userId || (canHire && m.sideVillageId === ledVillage?.id),
        ),
      };
    }),
  /** Reserve a pending slot for a main village's Kage; tokens are charged on acceptance. */
  inviteMercenary: protectedProcedure
    .input(
      z.object({
        warId: z.string(),
        userId: z.string(),
        tokens: z.number().int().min(1).max(WAR_MERCENARY_MAX_TOKENS),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, target, activeWar, payer, roster] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        findWarForInviteMercenary(ctx.drizzle, input),
        findVillageForInviteMercenary(ctx.drizzle, ctx),
        listWarMercenaryForInviteMercenary(ctx.drizzle, input),
      ]);
      if (
        !activeWar?.rules ||
        activeWar.status !== "ACTIVE" ||
        activeWar.endedAt ||
        !payer ||
        user.villageId !== payer.id ||
        ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(payer.id)
      )
        return errorResponse(
          "Only a participating village's Kage can hire mercenaries.",
        );
      if (
        user.isBanned ||
        target.isBanned ||
        target.isAi ||
        target.villageId === payer.id ||
        (getWarSide(activeWar, target.villageId) &&
          getWarSide(activeWar, target.villageId) !== payer.id)
      )
        return errorResponse(
          "Choose a player from another non-enemy village, an ally, or an outlaw.",
        );
      if (payer.tokens < input.tokens)
        return errorResponse("Your village does not have enough tokens.");
      const slots = new Set(
        roster.filter((m) => m.sideVillageId === payer.id).map((m) => m.slot),
      );
      const slot = Array.from(
        { length: WAR_MERCENARY_LIMIT },
        (_, index) => index,
      ).find((index) => !slots.has(index));
      if (slot === undefined)
        return errorResponse(
          "All mercenary slots are occupied. Pending invitations reserve a slot.",
        );
      try {
        const saved = await retryOnDeadlock(() =>
          executeSavedForInviteMercenary(ctx.drizzle, input, ctx, slot, payer),
        );
        return saved.rowsAffected > 0
          ? {
              success: true,
              userPatch: {},
              message:
                "Invitation sent. Tokens are charged only when the player accepts.",
            }
          : errorResponse("The war, Kage or balance changed. Refresh and try again.");
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse(
            "The roster changed or this player is already invited. Refresh and try again.",
          );
        throw error;
      }
    }),
  /** Accept the caller's invitation, atomically exchanging village tokens for player Ryo. */
  acceptMercenary: protectedProcedure
    .input(z.object({ contractId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await acceptWarMercenary(
        ctx.drizzle,
        input.contractId,
        ctx.userId,
      );
      return result;
    }),
  /**
   * Let the player or employing Kage close a contract without refunding payment.
   * Clear an unfinished mission only when it matches an accepted contract's war and
   * side; pending cancellations preserve the player's missions.
   */
  leaveMercenary: protectedProcedure
    .input(z.object({ contractId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const saved = await retryOnDeadlock(() =>
        executeSavedForLeaveMercenary(ctx.drizzle, input, ctx),
      );
      return saved.rowsAffected > 0
        ? {
            success: true,
            message: "Mercenary contract closed. Payments are not refunded.",
          }
        : errorResponse("Contract already closed or you are not authorized.");
    }),
  /** Read configurable defaults; approved wars use their own immutable snapshots. */
  getRules: protectedProcedure.query(({ ctx }) => fetchWarRules(ctx.drizzle)),
  /** Save the complete staff configuration in one upsert, without a transaction. */
  setRules: protectedProcedure
    .input(warRulesSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canModifyCombatSettings(user.role)) return errorResponse("Not allowed");
      // One upsert prevents declarations seeing a partially saved configuration.
      await insertGameSettingForSetRules(ctx.drizzle, input);
      return {
        success: true,
        message: "War settings saved. Changes apply to newly approved wars.",
      };
    }),
  /** Load panel data together and mask locations according to the viewer's own side. */
  getObjectiveWarInfo: protectedProcedure
    .input(warIdSchema)
    .query(async ({ ctx, input }) => {
      const [
        activeWar,
        user,
        missions,
        camps,
        contributions,
        completedQuests,
        ownVillage,
        kills,
        mercenaryHistory,
        mercenaryWarId,
      ] = await Promise.all([
        findWarForGetObjectiveWarInfo(ctx.drizzle, input),
        fetchUser(ctx.drizzle, ctx.userId),
        listQuestForGetObjectiveWarInfo(ctx.drizzle),
        listWarCampForGetObjectiveWarInfo(ctx.drizzle, input),
        selectWarContributionForGetObjectiveWarInfo(ctx.drizzle, input),
        listQuestHistoryForGetObjectiveWarInfo(ctx.drizzle, ctx),
        selectVillageForGetObjectiveWarInfo(ctx.drizzle, ctx),
        listWarKillForGetObjectiveWarInfo(ctx.drizzle, input),
        listWarMercenaryForGetObjectiveWarInfo(ctx.drizzle, input),
        fetchMercenaryWarId(ctx.drizzle, ctx.userId),
      ]);
      if (
        !activeWar?.rules ||
        !getWarSide(activeWar, user.villageId, user.userId, mercenaryWarId)
      )
        return null;
      const side = getWarSide(activeWar, user.villageId, user.userId, mercenaryWarId)!;
      const mercenaryIds = new Set(mercenaryHistory.map((m) => m.userId));
      const isMasked = (id: string) => mercenaryIds.has(id) && id !== ctx.userId;
      const displayName = (id: string, name: string | null | undefined) =>
        isMasked(id) ? "Mercenary" : (name ?? "Unknown ninja");
      const combatContributions = new Map<
        string,
        {
          userId: string;
          username: string;
          isMasked: boolean;
          kills: number;
          losses: number;
        }
      >();
      for (const kill of kills) {
        for (const participant of [
          { userId: kill.killerId, user: kill.killer, result: "kills" as const },
          { userId: kill.victimId, user: kill.victim, result: "losses" as const },
        ]) {
          const contribution = combatContributions.get(participant.userId) ?? {
            userId: participant.userId,
            username: displayName(participant.userId, participant.user?.username),
            isMasked: isMasked(participant.userId),
            kills: 0,
            losses: 0,
          };
          contribution[participant.result] += 1;
          combatContributions.set(participant.userId, contribution);
        }
      }
      return {
        war: maskWarObjectives(
          activeWar,
          user.villageId,
          user.rank === "ELDER" || ownVillage[0]?.kageId === user.userId,
          ctx.userId,
        ),
        missions: missions
          .filter(
            (q) =>
              isObjectiveWarActive(activeWar) &&
              isAvailableUserQuests(q, { ...user, completedQuests }, true, true).check,
          )
          .flatMap((q) =>
            q.content.objectives
              .filter(
                (o) =>
                  (o.task === "espionage" &&
                    !areWarObjectivesRevealed(activeWar, side)) ||
                  (o.task === "sabotage" && areWarObjectivesRevealed(activeWar, side)),
              )
              .map((o) => ({ questId: q.id, name: q.name, objective: o })),
          ),
        camps,
        contributions: contributions.map((row) => ({
          ...row,
          userId: isMasked(row.userId) ? null : row.userId,
          username: displayName(row.userId, row.username),
          isMasked: isMasked(row.userId),
        })),
        combatContributions: [...combatContributions.values()]
          .map((row) => ({
            ...row,
            userId: row.isMasked ? null : row.userId,
          }))
          .sort(
            (a, b) =>
              b.kills - a.kills ||
              a.losses - b.losses ||
              a.username.localeCompare(b.username),
          ),
        attempt: user.warMission,
      };
    }),
  /** Claim one concurrent attempt with its authored value and required location frozen. */
  startWarMission: protectedProcedure
    .input(startWarMissionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [activeWar, user, mission, completedQuests, mercenaryWarId] =
        await Promise.all([
          findWarForStartWarMission(ctx.drizzle, input),
          fetchUser(ctx.drizzle, ctx.userId),
          fetchQuest(ctx.drizzle, input.questId),
          listQuestHistoryForGetObjectiveWarInfo(ctx.drizzle, ctx),
          fetchMercenaryWarId(ctx.drizzle, ctx.userId),
        ]);
      const side = activeWar
        ? getWarSide(activeWar, user.villageId, user.userId, mercenaryWarId)
        : null;
      const objective = mission?.content.objectives.find(
        (o) => o.id === input.objectiveId,
      );
      if (
        !activeWar?.rules ||
        activeWar.endedAt ||
        !side ||
        !mission ||
        mission.hidden ||
        mission.questType !== "war" ||
        !objective ||
        (objective.task !== "espionage" && objective.task !== "sabotage") ||
        !("durationSeconds" in objective) ||
        objective.value <= 0
      )
        return errorResponse("This war mission is unavailable");
      if (!isObjectiveWarActive(activeWar))
        return errorResponse("War missions are only available during active combat");
      const eligibility = isAvailableUserQuests(
        mission,
        { ...user, completedQuests },
        true,
        true,
      );
      if (!eligibility.check) return errorResponse(eligibility.message);
      if (user.isBanned || user.status !== "AWAKE" || user.warMission)
        return errorResponse("You must be awake with no pending war mission");
      const enemyId =
        side === activeWar.attackerVillageId
          ? activeWar.defenderVillageId
          : activeWar.attackerVillageId;
      const target =
        side === activeWar.attackerVillageId
          ? activeWar.defenderVillage
          : activeWar.attackerVillage;
      if (objective.task === "espionage" && user.sector !== target?.sector)
        return errorResponse("Travel to the enemy village to conduct espionage");
      if (
        objective.task === "sabotage" &&
        (!areWarObjectivesRevealed(activeWar, side) ||
          !activeWar.objectiveState?.objectives.some(
            (o) => o.sector === user.sector && o.villageId === enemyId && !o.destroyed,
          ))
      )
        return errorResponse(
          "Travel to a revealed enemy objective shrine to sabotage it",
        );
      if (objective.task === "espionage" && areWarObjectivesRevealed(activeWar, side))
        return errorResponse("Your espionage counter is already full");
      const attempt = {
        id: nanoid(),
        warId: activeWar.id,
        questId: mission.id,
        objectiveId: objective.id,
        sideVillageId: side,
        villageId: user.villageId,
        sector: user.sector,
        task: objective.task,
        value: objective.value,
        endsAt: secondsFromNow(objective.durationSeconds).toISOString(),
      };
      const saved = await updateUserDataForStartWarMission(
        ctx.drizzle,
        attempt,
        ctx,
        user,
        activeWar,
        side,
      );
      if (!saved.rowsAffected)
        return errorResponse("Your situation changed. Refresh and try again.");
      return {
        success: true,
        message: "War mission started. Remain in this sector until completion.",
      };
    }),
  /** Consume the matching ready attempt inside the strategic effect's receipt boundary. */
  completeWarMission: protectedProcedure
    .input(completeWarMissionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const attempt = user.warMission;
      if (!attempt || attempt.id !== input.attemptId)
        return errorResponse("No matching war mission");
      if (!hasRequiredRank(user.rank, WAR_MISSION_REQUIRED_RANK))
        return errorResponse(
          `War missions require ${capitalizeFirstLetter(WAR_MISSION_REQUIRED_RANK)} rank or higher`,
        );
      const [activeWar, mercenaryWarId] = await Promise.all([
        findWarForCompleteWarMission(ctx.drizzle, attempt),
        fetchMercenaryWarId(ctx.drizzle, ctx.userId),
      ]);
      if (activeWar && !isObjectiveWarActive(activeWar))
        return errorResponse("War missions are only available during active combat");
      if (
        !activeWar?.rules ||
        activeWar.endedAt ||
        user.isBanned ||
        user.status !== "AWAKE" ||
        user.villageId !== attempt.villageId ||
        getWarSide(activeWar, user.villageId, user.userId, mercenaryWarId) !==
          attempt.sideVillageId ||
        user.sector !== attempt.sector
      )
        return errorResponse(
          "This mission cannot be completed from your current location or village",
        );
      if (new Date(attempt.endsAt) > new Date())
        return errorResponse("The mission timer has not finished");
      const objectiveIndex =
        activeWar.objectiveState?.objectives.findIndex(
          (o) =>
            o.sector === attempt.sector &&
            o.villageId !== attempt.sideVillageId &&
            !o.destroyed,
        ) ?? -1;
      if (
        attempt.task === "sabotage" &&
        (objectiveIndex < 0 ||
          !areWarObjectivesRevealed(activeWar, attempt.sideVillageId))
      )
        return errorResponse("The sabotage target is no longer available");
      const applied = await applyObjectiveWarAction(ctx.drizzle, activeWar, {
        id: attempt.id,
        userId: user.userId,
        sideVillageId: attempt.sideVillageId,
        ...(attempt.task === "espionage"
          ? { espionage: attempt.value }
          : { objectiveIndex, shrineDamage: attempt.value }),
        claim: async (tx) => {
          const result = await updateUserDataForClaim(
            tx,
            user,
            attempt,
            activeWar,
            ctx,
          );
          return result.rowsAffected > 0;
        },
      });
      return applied
        ? {
            success: true,
            message: "War objective completed",
            userPatch: { warMission: null },
          }
        : errorResponse(
            "The war or mission changed before completion. Refresh to continue.",
          );
    }),
  /** Clear only the named attempt so a stale cancellation cannot delete its replacement. */
  cancelWarMission: protectedProcedure
    .input(completeWarMissionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const cancelled = await updateUserDataForCancelWarMission(
        ctx.drizzle,
        ctx,
        input,
      );
      return {
        success: true,
        message: "War mission cancelled",
        userPatch: cancelled.rowsAffected ? { warMission: null } : undefined,
      };
    }),
  /** Enter shrine combat with the camp snapshot preloaded for later score settlement. */
  attackWarCamp: protectedProcedure
    .input(warCampSchema)
    .mutation(async ({ ctx, input }) => {
      const [camp, user, mercenaryWarId, activeWar] = await Promise.all([
        findWarCampForAttackWarCamp(ctx.drizzle, input),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMercenaryWarId(ctx.drizzle, ctx.userId),
        findWarForAttackWarCamp(ctx.drizzle, input),
      ]);
      if (
        !camp ||
        camp.resolvedAt ||
        camp.startsAt > new Date() ||
        camp.endsAt <= new Date()
      )
        return errorResponse("War camp is closed");
      const side = activeWar
        ? getWarSide(activeWar, user.villageId, user.userId, mercenaryWarId)
        : null;
      if (
        !activeWar ||
        !side ||
        !isObjectiveWarActive(activeWar) ||
        user.isBanned ||
        user.sector !== camp.sector ||
        user.status !== "AWAKE"
      )
        return errorResponse("Travel to the camp as an active war participant");
      return initiateBattle(
        {
          userIds: [user.userId],
          targetIds: [camp.guardianId],
          client: ctx.drizzle,
          sector: camp.sector,
          forceDefenderVillageId:
            side === activeWar.attackerVillageId
              ? activeWar.defenderVillageId
              : activeWar.attackerVillageId,
          warCamp: camp,
        },
        "SHRINE_WAR",
      );
    }),
  /**
   * List open camps for main villages, accepted allies and mercenaries, respecting
   * the player's exclusive mercenary appointment.
   */
  getWarCampNotices: protectedProcedure.query(async ({ ctx }) => {
    return selectWarCampForGetWarCampNotices(ctx.drizzle, ctx);
  }),
  /** Expose only damage balances still eligible for their single postwar conversion. */
  getWarPointClaims: protectedProcedure.query(({ ctx }) =>
    selectWarContributionForGetWarPointClaims(ctx.drizzle, ctx),
  ),
  /** Grant prestige and consume eligibility in one guarded joined UPDATE. */
  convertWarPoints: protectedProcedure
    .input(warIdSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const saved = await executeSavedForConvertWarPoints(ctx.drizzle, input, ctx);
      return saved.rowsAffected > 0
        ? {
            success: true,
            message: "All war points converted to prestige",
          }
        : errorResponse("No unclaimed war points remain in the conversion window");
    }),
  /** Preview structure eligibility; declaration rechecks membership, funds and cooldowns under lock. */
  getRaidOptions: protectedProcedure
    .input(raidOptionsSchema)
    .query(async ({ ctx, input }) => {
      const [user, attacker, ownStructures, targetStructures, count] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchVillage(ctx.drizzle, input.userVillageId),
          fetchStructures(ctx.drizzle, input.userVillageId),
          fetchStructures(ctx.drizzle, input.targetVillageId),
          getVillageMemberCount(ctx.drizzle, input.userVillageId),
        ]);
      const block =
        !attacker || !isFactionVillage(attacker) || user.villageId !== attacker.id
          ? "Only factions can initiate raids"
          : count < FACTION_RAID_MIN_MEMBERS
            ? `Your faction needs at least ${FACTION_RAID_MIN_MEMBERS} members`
            : attacker.tokens < FACTION_RAID_COST
              ? `Your faction needs ${FACTION_RAID_COST.toLocaleString()} tokens`
              : undefined;
      return FACTION_RAID_STRUCTURE_ROUTES.map((route) => ({
        route,
        block:
          block ??
          (attacker
            ? getRaidDeclarationBlock(
                attacker,
                ownStructures,
                targetStructures,
                input.targetVillageId,
                route,
              )
            : "Faction unavailable"),
      }));
    }),
  /**
   * Return the viewer's effective participation for their own or an empty village ID;
   * other village IDs filter village participation. Mask objectives for the viewer.
   */
  getActiveWars: protectedProcedure
    .meta({
      mcp: {
        description:
          "Get active wars for your effective participation when villageId is your own or empty; otherwise, get wars involving the requested village. Objectives follow your viewing permissions.",
      },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [wars, viewer, ledVillage] = await Promise.all([
        fetchActiveWars(ctx.drizzle),
        fetchUser(ctx.drizzle, ctx.userId),
        findLedVillageId(ctx.drizzle, ctx.userId),
      ]);
      return wars
        .filter((w) =>
          input.villageId === viewer.villageId || !input.villageId
            ? !!getWarSide(w, viewer.villageId, ctx.userId)
            : isVillageInvolvedInAnyWar([w], input.villageId),
        )
        .map((w) =>
          maskWarObjectives(
            w,
            viewer.villageId,
            viewer.rank === "ELDER" || ledVillage?.id === viewer.villageId,
            ctx.userId,
          ),
        );
    }),

  // Get ended wars for a village
  getEndedWars: protectedProcedure
    .meta({
      mcp: { description: "Get ended wars for a village" },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return fetchEndedWars(ctx.drizzle, input.villageId);
    }),

  adminEndWar: protectedProcedure
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, activeWar] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchActiveWar(ctx.drizzle, input.warId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!activeWar) return errorResponse("War not found");
      if (!canAdministrateWars(user.role)) {
        return errorResponse("You are not authorized to end wars");
      }
      // End war
      await Promise.all([
        deleteWarForAdminEndWar(ctx.drizzle, input),
        deleteWarKillForAdminEndWar(ctx.drizzle, input),
        deleteWarAllyForAdminEndWar(ctx.drizzle, input),
        insertActionLogForAdminEndWar(ctx.drizzle, ctx, activeWar, input),
      ]);
      return { success: true, message: "War ended successfully" };
    }),

  buildShrine: protectedProcedure
    .meta({
      mcp: { description: "Build a shrine to claim a sector" },
    })
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, exclusiveRaids] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWar(ctx.drizzle, input.warId),
        // Fetch all exclusive raids (filter by sector after we know the war's sector)
        listVisibleRaidQuests(ctx.drizzle),
      ]);

      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to build a shrine");
      }
      if (isFactionVillage(user.village)) {
        return errorResponse("Factions cannot purchase sectors");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to build a shrine");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can build shrines");
      }
      if (!activeWar) {
        return errorResponse("War not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (activeWar.type !== "SECTOR_WAR") {
        return errorResponse("War is not a sector war");
      }
      if (activeWar.defenderShrineHp > 0) {
        return errorResponse("Shrine is still standing");
      }
      if (MAP_RESERVED_SECTORS.includes(activeWar.sector)) {
        return errorResponse("Shrine cannot be built on reserved sectors");
      }

      // Check if there's an active exclusive raid for this sector that must be completed first
      const activeExclusiveRaid = findActiveExclusiveRaidForSector(
        exclusiveRaids,
        activeWar.sector,
      );

      if (activeExclusiveRaid) {
        return errorResponse(
          "You must defeat the raid boss before claiming this sector! Check the shrine page to join the raid.",
        );
      }

      if (user.village.tokens < WAR_PURCHASE_SHRINE_TOKEN_COST) {
        return errorResponse(
          `Your village needs ${WAR_PURCHASE_SHRINE_TOKEN_COST} tokens to build a shrine`,
        );
      }
      if (activeWar.attackerVillageId !== user.villageId) {
        return errorResponse("Only the attacking village can build shrines");
      }

      const settled = await handleWarEnd(activeWar, ctx.drizzle, {
        shrineBuilderId: ctx.userId,
      });
      if (settled.status !== "ATTACKER_VICTORY") {
        return errorResponse(
          "War or village changed. Refresh before building the shrine.",
        );
      }
      return { success: true, message: "Shrine built successfully" };
    }),

  declareSectorWar: protectedProcedure
    .meta({
      mcp: {
        description: "Declare a sector war on a map sector",
      },
    })
    .input(z.object({ sectorId: z.number(), userVillageId: z.string().nullable() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, villages, relationships, targetSector, sectorCount] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchActiveWars(ctx.drizzle),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchSector(ctx.drizzle, input.sectorId),
          countVillageSectors(ctx.drizzle, input.userVillageId),
        ]);
      // Derived
      const now = new Date();
      const attackerVillage = villages.find((v) => v.id === user?.village?.id);
      const defenderVillage = villages.find((v) => v.id === targetSector?.villageId);
      const defenderVillageId = defenderVillage?.id || VILLAGE_SYNDICATE_ID;

      // Check minimum member count for war participation (after we know village IDs)
      const [attackerMemberCount, actualDefenderCount] = await Promise.all([
        attackerVillage ? getVillageMemberCount(ctx.drizzle, attackerVillage.id) : 0,
        defenderVillage ? getVillageMemberCount(ctx.drizzle, defenderVillage.id) : 0,
      ]);
      const relationship = findRelationship(
        relationships,
        attackerVillage?.id || "",
        defenderVillageId,
      );
      const activeSectorWars = activeWars.filter(
        (w) =>
          (w.attackerVillageId === user?.village?.id ||
            w.defenderVillageId === user?.village?.id) &&
          w.type === "SECTOR_WAR",
      );
      const sectorVillage = villages.find((v) => v.sector === input.sectorId);
      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (isFactionVillage(user.village)) {
        return errorResponse("Factions cannot purchase sectors");
      }
      if (sectorVillage) {
        return errorResponse("This sector is already occupied");
      }
      if (input.userVillageId && input.userVillageId !== user.villageId) {
        return errorResponse(
          "Your village does not seem to match that on your profile",
        );
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare sector wars");
      }
      if (user.village.tokens < WAR_DECLARATION_COST) {
        return errorResponse(
          `Your village needs ${WAR_DECLARATION_COST.toLocaleString()} tokens to declare war`,
        );
      }
      if (!attackerVillage) {
        return errorResponse("Village not found");
      }
      if (relationship && relationship?.status !== "ENEMY") {
        return errorResponse("You can only declare war on enemy villages");
      }
      if (MAP_RESERVED_SECTORS.includes(input.sectorId)) {
        return errorResponse("This sector is reserved and cannot be claimed");
      }
      if (
        targetSector &&
        attackerVillage.warExhaustionEndedAt &&
        attackerVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Your village is under war exhaustion");
      }
      if (attackerVillage.id === defenderVillageId) {
        return errorResponse("You cannot declare sector war on your own sector");
      }
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === user?.village?.id && w.sector === input.sectorId,
        )
      ) {
        return errorResponse("You are already at war for this sector");
      }
      if (activeSectorWars.length > 0) {
        return errorResponse(
          `You are already in a sector war for sector ${activeSectorWars.map((w) => w.sector).join(", ")}`,
        );
      }
      if (activeSectorWars.length >= SHRINE_MAX_PER_VILLAGE) {
        return errorResponse(
          `You can only own ${SHRINE_MAX_PER_VILLAGE} sectors at a time`,
        );
      }
      if (user.isOutlaw && sectorCount >= WAR_FACTION_MAX_SECTORS) {
        return errorResponse(
          `Your faction has too many sectors. Can max own ${WAR_FACTION_MAX_SECTORS} sectors`,
        );
      }
      if (!user.isOutlaw && sectorCount >= WAR_VILLAGE_MAX_SECTORS) {
        return errorResponse(
          `Your village has too many sectors. Can max own ${WAR_VILLAGE_MAX_SECTORS} sectors`,
        );
      }
      if (
        activeWars.find(
          (w) =>
            (w.attackerVillageId === user?.village?.id &&
              w.defenderVillageId === defenderVillageId) ||
            (w.attackerVillageId === defenderVillageId &&
              w.defenderVillageId === user?.village?.id),
        )
      ) {
        return errorResponse("You are already at war against the owner village.");
      }

      // Check if attacker village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, user?.village?.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Your village is already involved in an active war");
      }

      // Check if target village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, defenderVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Check minimum member count for war participation
      if (attackerVillage && attackerMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to declare sector war`,
        );
      }
      if (defenderVillage && actualDefenderCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be attacked`,
        );
      }

      const warId = nanoid();
      const started = await startSectorWar(ctx.drizzle, {
        id: warId,
        attackerVillageId: user.villageId,
        defenderVillageId,
        initiatedByUserId: user.userId,
        sectorId: input.sectorId,
      });
      if (!started) {
        return errorResponse(
          "Village availability, sector ownership or tokens changed. Refresh and try again.",
        );
      }
      await Promise.all([
        insertNotificationForDeclareSectorWar(
          ctx.drizzle,
          user,
          attackerVillage,
          input,
        ),
        updateUserDataForDeclareSectorWar(
          ctx.drizzle,
          { villageId: user.villageId },
          defenderVillageId,
        ),
      ]);
      notifyWarVillages(ctx.drizzle, [user.villageId, defenderVillageId], warId);
      return {
        success: true,
        message: "Sector war declared successfully",
      };
    }),

  // Declare war on another village
  declareVillageWarOrRaid: protectedProcedure
    .meta({
      mcp: { description: "Declare village war or raid" },
    })
    .input(declareVillageWarSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Single pre-fetch round: user, war state, village data, and elder/cooldown checks all in parallel
      const [
        { user },
        activeWars,
        villages,
        relationships,
        structures,
        attackerMemberCount,
        defenderMemberCount,
        recentRejection,
        existingPending,
        elders,
        attackerStructures,
      ] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchActiveWars(ctx.drizzle),
        fetchVillages(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
        fetchStructures(ctx.drizzle, input.targetVillageId),
        getVillageMemberCount(ctx.drizzle, input.userVillageId),
        getVillageMemberCount(ctx.drizzle, input.targetVillageId),
        findVillageElderVoteForDeclareVillageWarOrRaid(ctx.drizzle, input),
        findVillageElderVoteForDeclareVillageWarOrRaid2(ctx.drizzle, input),
        listUserDataForDeclareVillageWarOrRaid(ctx.drizzle, input),
        fetchStructures(ctx.drizzle, input.userVillageId),
      ]);
      // Derived
      const now = new Date();
      const attackerVillage = villages.find((v) => v.id === user?.village?.id);
      const defenderVillage = villages.find((v) => v.id === input.targetVillageId);
      const relationship = findRelationship(
        relationships,
        attackerVillage?.id || "",
        defenderVillage?.id || "",
      );
      const targetIsOutlaw = ["STRONGHOLD", "HIDEOUT", "OUTLAW"].includes(
        defenderVillage?.type || "",
      );
      const isRaid = !!attackerVillage && isFactionVillage(attackerVillage);
      const configuredRules = !isRaid ? await fetchWarRules(ctx.drizzle) : null;
      const declarationCost = isRaid
        ? FACTION_RAID_COST
        : configuredRules?.enabled
          ? configuredRules.declarationCost
          : WAR_DECLARATION_COST;
      const warType = isRaid ? "WAR_RAID" : "VILLAGE_WAR";
      const relationshipStatus = isRaid ? "ENEMY" : relationship?.status;
      const structure = structures.find((s) => s.route === input.targetStructureRoute);
      // Exclude the kage (war initiator) from the elder count
      const eligibleElders = elders.filter((e) => e.userId !== user?.userId);

      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (user.villageId !== input.userVillageId) {
        return errorResponse("Village mismatch — please refresh and try again");
      }
      if (!structure) {
        return errorResponse("Structure not found");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare war");
      }
      if (!isRaid && recentRejection) {
        const cooldownEnd = new Date(
          recentRejection.endsAt.getTime() +
            WAR_DECLARATION_COOLDOWN_HOURS * 3600 * 1000,
        );
        return errorResponse(
          `War declaration is on cooldown after a recent rejection or cancellation. Available again at ${cooldownEnd.toUTCString()}.`,
        );
      }
      if (!isRaid && existingPending) {
        return errorResponse("Your village already has a pending war declaration vote");
      }

      if (user.village.tokens < declarationCost) {
        return errorResponse(
          `Your village needs ${declarationCost.toLocaleString()} tokens to declare ${isRaid ? "a raid" : "war"}`,
        );
      }
      if (!attackerVillage || !defenderVillage) {
        return errorResponse("Village not found");
      }
      if (!isRaid && targetIsOutlaw)
        return errorResponse("Only factions can initiate raids");
      if (isRaid) {
        const block = getRaidDeclarationBlock(
          attackerVillage!,
          attackerStructures,
          structures,
          input.targetVillageId,
          input.targetStructureRoute,
          now,
        );
        if (block) return errorResponse(block);
      }
      if (relationshipStatus !== "ENEMY") {
        return errorResponse("You can only declare war on enemy villages");
      }
      if (!["VILLAGE", "STRONGHOLD", "HIDEOUT"].includes(attackerVillage.type)) {
        return errorResponse("You cannot declare war on this type of village");
      }
      if (!["VILLAGE", "STRONGHOLD", "HIDEOUT"].includes(defenderVillage.type)) {
        return errorResponse("You cannot declare war on this type of village");
      }
      if (!isRaid && defenderVillage.tokens < WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE) {
        return errorResponse(
          `Target village needs ${WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE.toLocaleString()} tokens to declare war`,
        );
      }
      if (!attackerVillage.allianceSystem && warType === "VILLAGE_WAR") {
        return errorResponse("Your village is not part of the alliance system");
      }
      if (!defenderVillage.allianceSystem && warType === "VILLAGE_WAR") {
        return errorResponse("Target village is not part of the alliance system");
      }
      if (
        !isRaid &&
        attackerVillage.warExhaustionEndedAt &&
        attackerVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Your village is under war exhaustion");
      }
      if (
        !isRaid &&
        defenderVillage.warExhaustionEndedAt &&
        defenderVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Target village is under war exhaustion");
      }
      if (attackerVillage.id === defenderVillage.id) {
        return errorResponse("You cannot declare war on your own village");
      }
      if (
        activeWars.find(
          (w) =>
            (w.type === "VILLAGE_WAR" &&
              w.attackerVillageId === user?.village?.id &&
              w.defenderVillageId === input.targetVillageId) ||
            (w.type === "VILLAGE_WAR" &&
              w.attackerVillageId === input.targetVillageId &&
              w.defenderVillageId === user?.village?.id),
        )
      ) {
        return errorResponse("You are already at war with this village");
      }
      if (
        activeWars.find((w) =>
          w.warAllies.some(
            (f) =>
              f.villageId === user?.village?.id &&
              f.supportVillageId === input.targetVillageId,
          ),
        )
      ) {
        return errorResponse("You are already supporting this village");
      }
      if (
        activeWars.find(
          (w) =>
            w.type === "WAR_RAID" &&
            w.attackerVillageId === user?.village?.id &&
            w.defenderVillageId === input.targetVillageId &&
            w.targetStructureRoute === input.targetStructureRoute,
        )
      ) {
        return errorResponse("You are already raiding this village structure");
      }

      // Check if attacker village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, user?.village?.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Your village is already involved in an active war");
      }

      // Check if target village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, input.targetVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Check minimum member count for war participation
      if (
        attackerMemberCount <
        (isRaid ? FACTION_RAID_MIN_MEMBERS : WAR_MINIMUM_MEMBERS_REQUIRED)
      ) {
        return errorResponse(
          `Your village needs at least ${isRaid ? FACTION_RAID_MIN_MEMBERS : WAR_MINIMUM_MEMBERS_REQUIRED} members to declare ${isRaid ? "a raid" : "war"}`,
        );
      }
      if (!isRaid && defenderMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be attacked`,
        );
      }

      // Factions have no elder council, so their leader's declaration is the approval
      if (isFactionVillage(attackerVillage)) {
        const started = await startDeclaredWar(ctx.drizzle, {
          attackerVillageId: attackerVillage.id,
          attackerVillageName: attackerVillage.name,
          defenderVillageId: defenderVillage.id,
          defenderVillageName: defenderVillage.name,
          defenderKageId: defenderVillage.kageId,
          initiatedByUserId: user.userId,
          warType,
          targetStructureRoute: structure.route,
        });
        if (!started) {
          return errorResponse(
            "War could not start: a village is already involved in a war or your village no longer has enough tokens.",
          );
        }
        return {
          success: true,
          message: `Raid against ${defenderVillage.name} has started!`,
        };
      }

      // Require minimum elder count to proceed with war declaration
      if (eligibleElders.length < ELDER_MIN_VOTING_COUNT)
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders must be in position before war can be declared`,
        );

      // Insert vote — existingPending guard above prevents concurrent dupes
      const voteId = nanoid();
      const endsAt = secondsFromNow(ELDER_WAR_VOTE_HOURS * 3600);
      await insertVillageElderVoteForDeclareVillageWarOrRaid(
        ctx.drizzle,
        voteId,
        { villageId: user.villageId, userId: user.userId },
        input,
        warType,
        structure,
        endsAt,
      );
      const elderContent = `${user.username} has submitted a war declaration against ${defenderVillage.name}. You have ${ELDER_WAR_VOTE_HOURS} hours to vote.`;
      const kageContent = `Your war declaration against ${defenderVillage.name} has been submitted. Elders have ${ELDER_WAR_VOTE_HOURS} hours to vote.`;
      const elderUserIds = eligibleElders.map((e) => e.userId);
      const allNotifyIds = [user.userId, ...elderUserIds];
      await Promise.all([
        insertNotificationForDeclareVillageWarOrRaid(
          ctx.drizzle,
          user,
          kageContent,
          elderUserIds,
          elderContent,
        ),
        incrementNotificationCounters(ctx.drizzle, allNotifyIds),
      ]);
      return {
        success: true,
        message: `War declaration submitted. Elders have ${ELDER_WAR_VOTE_HOURS} hours to vote.`,
      };
    }),

  // Create an offer for factions to join the war
  createAllyOffer: protectedProcedure
    .meta({
      mcp: { description: "Create ally offer for war support" },
    })
    .input(
      z.object({
        warId: z.string(),
        tokenOffer: z.int().min(1000),
        targetVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, villages, relationships, allActiveWars] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchActiveWar(ctx.drizzle, input.warId),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchActiveWars(ctx.drizzle),
        ]);
      // Derived
      const targetVillage = villages.find((v) => v.id === input.targetVillageId);

      // Check minimum member count for war participation (after we know village IDs)
      const [userVillageMemberCount, targetVillageMemberCount] = await Promise.all([
        user?.villageId ? getVillageMemberCount(ctx.drizzle, user.villageId) : 0,
        targetVillage ? getVillageMemberCount(ctx.drizzle, targetVillage.id) : 0,
      ]);
      // Guard
      if (!user?.village || !user?.villageId) {
        return errorResponse("You must be in a village to create faction offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can create faction offers");
      }
      if (!activeWar) {
        return errorResponse("War not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (!["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
        return errorResponse(
          "War ally offers only available for village wars and raids",
        );
      }
      if (
        ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          user.villageId,
        )
      ) {
        return errorResponse("You are not part of this war");
      }
      if (user.village.tokens < input.tokenOffer) {
        return errorResponse("Not enough tokens to create offer");
      }

      // Check if payment exceeds max percentage of village tokens
      const maxPayment = Math.floor(
        user.village.tokens * WAR_ALLY_MAX_PAYMENT_PERCENTAGE,
      );
      const maxPercentage = WAR_ALLY_MAX_PAYMENT_PERCENTAGE * 100;
      if (input.tokenOffer > maxPayment) {
        return errorResponse(
          `Payment cannot exceed ${maxPercentage}% of village tokens (max: ${maxPayment.toLocaleString()})`,
        );
      }
      if (!targetVillage) {
        return errorResponse("Target village not found");
      }
      if (
        [activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          input.targetVillageId,
        )
      ) {
        return errorResponse("Cannot create offer for a village already in the war");
      }

      // Check if target village is already involved in any other active war
      if (
        isVillageInvolvedInAnyWar(allActiveWars, input.targetVillageId, activeWar.id, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse(
          "Target village is already involved in another active war",
        );
      }

      if (userVillageMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to create ally offers`,
        );
      }
      if (targetVillageMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be invited to war`,
        );
      }

      // Final checks
      const { check, message } = canJoinWar(
        activeWar,
        relationships,
        targetVillage,
        user.village,
      );
      if (!check) {
        return errorResponse(message);
      }
      // Insert request
      await insertRequest(
        ctx.drizzle,
        user.userId,
        targetVillage.kageId,
        "WAR_ALLY",
        input.tokenOffer,
        activeWar.id,
      );

      // Return
      return { success: true, message: "Ally offer sent" };
    }),

  rejectAllyOffer: protectedProcedure
    .meta({ mcp: { description: "Reject a war ally offer" } })
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const [{ user }, request] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchRequest(ctx.drizzle, input.id, "WAR_ALLY"),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("Not in a village");
      if (!isKage(user)) return errorResponse("Not kage");
      if (!request) return errorResponse("Request not found");
      if (request.type !== "WAR_ALLY") return errorResponse("Not a war ally request");
      if (request.status !== "PENDING") return errorResponse("Request not pending");
      if (request.receiverId !== user.userId) return errorResponse("Not your request");

      if (!(await closeWarAllyOffer(ctx.drizzle, request.id, user.userId, "REJECTED")))
        return errorResponse("Offer is no longer pending");

      // Return
      return { success: true, message: "Faction offer rejected" };
    }),

  // Get faction offers for a war
  getAllyOffers: protectedProcedure
    .meta({
      mcp: { description: "Get pending war ally offers" },
    })
    .query(async ({ ctx }) => {
      return await fetchRequests(ctx.drizzle, ["WAR_ALLY"], 3600 * 12, ctx.userId);
    }),

  // Delist a faction offer
  cancelAllyOffer: protectedProcedure
    .meta({ mcp: { description: "Cancel a war ally offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, offer] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchRequest(ctx.drizzle, input.offerId, "WAR_ALLY"),
      ]);

      // Guard
      if (!offer) {
        return errorResponse("Offer not found");
      }
      if (!user?.village) {
        return errorResponse("You must be in a village to delist offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can delist offers");
      }
      if (offer.senderId !== user.userId) {
        return errorResponse("Not your offer to delist");
      }
      if (offer.status !== "PENDING")
        return errorResponse("Offer is no longer pending");

      if (!(await closeWarAllyOffer(ctx.drizzle, offer.id, user.userId, "CANCELLED")))
        return errorResponse("Offer is no longer pending");

      return { success: true, message: "Offer delisted" };
    }),

  // Accept a faction offer
  acceptAllyOffer: protectedProcedure
    .meta({ mcp: { description: "Accept a war ally offer" } })
    .input(z.object({ offerId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, request, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
        fetchRequest(ctx.drizzle, input.offerId, "WAR_ALLY"),
        fetchAlliances(ctx.drizzle),
      ]);
      // Derived
      const warId = request.relatedId;
      const activeWar = activeWars.find(
        (w) =>
          (w.attackerVillage?.kageId === request.senderId ||
            w.defenderVillage?.kageId === request.senderId) &&
          w.id === warId,
      );
      const senderVillage =
        activeWar?.attackerVillage?.kageId === request.senderId
          ? activeWar?.attackerVillage
          : activeWar?.defenderVillage;
      // Guard
      if (!request) {
        return errorResponse("Offer not found");
      }
      if (!senderVillage) {
        return errorResponse("Sender village not found");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village or faction to accept offers");
      }
      if (!user?.village) {
        return errorResponse("You must be in a village or faction to accept offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can accept offers");
      }
      if (!activeWar) {
        return errorResponse("No active war found for the one listing the offer");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (!["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
        return errorResponse(
          "War ally offers only available for village wars and raids",
        );
      }
      if (request.receiverId !== user.userId) {
        return errorResponse("This offer is not for your village");
      }
      if (request.status !== "PENDING")
        return errorResponse("Offer is no longer pending");
      if (request.senderId === user.userId) {
        return errorResponse("Cannot accept your own offer");
      }
      if (activeWar.warAllies.some((f) => f.villageId === user.villageId)) {
        return errorResponse("Already joined this war");
      }
      // Final checks
      const { check, message } = canJoinWar(
        activeWar,
        relationships,
        user.village,
        senderVillage,
      );
      if (!check) return errorResponse(message);
      return acceptWarAllyOffer(ctx.drizzle, {
        offerId: request.id,
        warId: activeWar.id,
        villageId: user.villageId,
        supportVillageId: senderVillage.id,
        userId: ctx.userId,
      });
    }),

  // Surrender war
  surrender: protectedProcedure
    .meta({ mcp: { description: "Surrender a war" } })
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
      ]);
      // Derived
      const activeWar = activeWars.find((w) => w.id === input.warId);
      const isMainCompetitor = [
        activeWar?.attackerVillageId,
        activeWar?.defenderVillageId,
      ].includes(user?.villageId || "unknown");
      const warAllyData = activeWar?.warAllies.find(
        (f) => f.villageId === user?.villageId,
      );
      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to surrender");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to surrender");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can surrender");
      }
      if (!activeWar) {
        return errorResponse("Active war was not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (!["WAR_RAID", "VILLAGE_WAR"].includes(activeWar.type)) {
        return errorResponse("Cannot surrender this type of war");
      }
      // Mutate
      if (isMainCompetitor) {
        await handleWarEnd(activeWar, ctx.drizzle, { losingVillageId: user.villageId });
      } else if (warAllyData) {
        return withdrawWarAlly(ctx.drizzle, activeWar.id, user.villageId, ctx.userId);
      } else {
        // Not part of the war
        return errorResponse("You are not part of this war");
      }
      return { success: true, message: "War surrendered and therefore lost" };
    }),

  getWarKills: protectedProcedure
    .meta({ mcp: { description: "Get war kill records" } })
    .input(z.object({ warId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [results, mercenaryHistory] = await Promise.all([
        listWarKillForGetWarKills(ctx.drizzle, input),
        listWarMercenaryForGetObjectiveWarInfo(ctx.drizzle, input),
      ]);
      // Accepted contracts keep identities private after dismissal; recorded villages
      // are credited war sides and remain visible alongside the kill records.
      const maskedIds = new Set(
        mercenaryHistory.filter((m) => m.userId !== ctx.userId).map((m) => m.userId),
      );
      return results
        .filter((kill) => kill.killer && kill.victim)
        .map((kill) => ({
          ...kill,
          killerId: maskedIds.has(kill.killerId) ? null : kill.killerId,
          victimId: maskedIds.has(kill.victimId) ? null : kill.victimId,
          killer: maskedIds.has(kill.killerId)
            ? {
                ...kill.killer,
                userId: null,
                username: "Mercenary",
                avatar: IMG_AVATAR_DEFAULT,
              }
            : kill.killer,
          victim: maskedIds.has(kill.victimId)
            ? {
                ...kill.victim,
                userId: null,
                username: "Mercenary",
                avatar: IMG_AVATAR_DEFAULT,
              }
            : kill.victim,
        }));
    }),

  getWarKillStats: protectedProcedure
    .meta({
      mcp: { description: "Get aggregated war kill statistics" },
    })
    .input(
      z.object({
        warId: z.string(),
        aggregateBy: z.enum(["townhallHpChange", "shrineHpChange", "totalKills"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Damage contributions count positive values only; negative values are losses.
      const aggregateField =
        input.aggregateBy === "townhallHpChange"
          ? warKill.townhallHpChange
          : warKill.shrineHpChange;
      const aggregate =
        input.aggregateBy === "totalKills"
          ? count()
          : sql<number>`sum(GREATEST(${aggregateField}, 0))`;
      const [results, mercenaryHistory] = await Promise.all([
        selectWarKillForGetWarKillStats(ctx.drizzle, aggregate, input),
        listWarMercenaryForGetObjectiveWarInfo(ctx.drizzle, input),
      ]);
      const maskedIds = new Set(
        mercenaryHistory.filter((m) => m.userId !== ctx.userId).map((m) => m.userId),
      );
      return results.map((row) =>
        maskedIds.has(row.killerId)
          ? {
              ...row,
              killerId: null,
              killerUsername: "Mercenary",
              killerAvatar: IMG_AVATAR_DEFAULT,
              villageId: null,
              villageName: null,
            }
          : row,
      );
    }),

  // Get pending elder votes for a village
  getElderVotes: protectedProcedure
    .meta({
      mcp: {
        description: "Get pending elder votes for a village",
      },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Optimistically fetch for the requested village; it is the user's own in
      // every normal case, so this stays a single round-trip.
      const [user, votes] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchElderVotes(ctx.drizzle, input.villageId),
      ]);
      // Staff may inspect any village. Everyone else only ever sees their own, so
      // a villageId the client cached before switching village re-reads the
      // current one instead of failing the townhall page with an error toast.
      if (canSeeSecretData(user.role) || user.villageId === input.villageId) {
        return votes;
      }
      if (!user.villageId) return [];
      return await fetchElderVotes(ctx.drizzle, user.villageId);
    }),

  // Kage cancels a pending war declaration before elders vote
  cancelWarDeclaration: protectedProcedure
    .meta({
      mcp: {
        description: "Cancel a pending war declaration vote (Kage only)",
      },
    })
    .input(z.object({ voteId: z.string(), userVillageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, voteRecord, elders] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
        selectUserDataForCancelWarDeclaration(ctx.drizzle, input),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.userVillageId)
        return errorResponse("Village mismatch — please refresh and try again");
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can cancel a war declaration");
      if (!voteRecord) return errorResponse("War declaration not found");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("This vote does not belong to your village");
      if (voteRecord.type !== "WAR_DECLARATION")
        return errorResponse("Can only cancel war declarations");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Can only cancel a pending war declaration");
      if (new Date(voteRecord.endsAt).getTime() <= Date.now())
        return errorResponse("Voting window has ended; cannot cancel");

      // Atomically cancel — guard ensures it's still PENDING.
      // Set endsAt = now so the cooldown window starts from the actual resolution time,
      // not the original scheduled deadline (which would be in the future).
      const updateRes = await updateVillageElderVoteForCancelWarDeclaration(
        ctx.drizzle,
        input,
      );

      if (updateRes.rowsAffected === 0)
        return errorResponse(
          "War declaration could not be cancelled — it may have already been resolved",
        );

      if (elders.length > 0) {
        const notifyIds = elders.map((e) => e.userId);
        await Promise.all([
          insertNotificationForCancelWarDeclaration(ctx.drizzle, notifyIds, user),
          incrementNotificationCounters(ctx.drizzle, notifyIds),
        ]);
      }

      return {
        success: true,
        message: "War declaration cancelled. No tokens were charged.",
      };
    }),

  // Elder votes on a pending war declaration
  voteOnWarDeclaration: protectedProcedure
    .meta({
      mcp: {
        description: "Vote on a pending war declaration as elder",
      },
    })
    .input(
      z.object({
        voteId: z.string(),
        vote: z.enum(["YES", "NO"]),
        userVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [{ user }, voteRecord, attackerVillage, elderCount] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
        fetchVillage(ctx.drizzle, input.userVillageId),
        selectUserDataForVoteOnWarDeclaration(ctx.drizzle, input).then(
          ([r]) => r?.count ?? 0,
        ),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.userVillageId)
        return errorResponse("Village mismatch — please refresh and try again");
      if (user.rank !== "ELDER") return errorResponse("Only elders can vote");
      if (!voteRecord) return errorResponse("Vote not found");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Vote is no longer pending");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("Vote is not for your village");
      if (voteRecord.type !== "WAR_DECLARATION")
        return errorResponse("Not a war declaration vote");
      if (user.userId === voteRecord.initiatedByUserId)
        return errorResponse(
          "The war declaration initiator cannot vote on their own motion",
        );
      if (new Date() > voteRecord.endsAt)
        return errorResponse("Voting period has ended");

      if (elderCount < ELDER_MIN_VOTING_COUNT) {
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders must be in position to vote`,
        );
      }

      // Insert the vote entry, re-fetch fresh entries, and resolve outcome
      const voteResult = await castElderVoteEntry(
        ctx.drizzle,
        input.voteId,
        user.userId,
        input.vote,
        elderCount,
      );
      if (!voteResult) return errorResponse("You have already voted");
      const { outcome, freshEntries } = voteResult;
      if (outcome === "APPROVED") {
        // Atomically claim the motion and pre-fetch needed data in parallel
        const [claimResult, defenderVillage, currentActiveWars] = await Promise.all([
          approvePendingWarDeclaration(ctx.drizzle, input.voteId),
          findVillageForVoteOnWarDeclaration(ctx.drizzle, voteRecord),
          fetchActiveWars(ctx.drizzle),
        ]);
        if (claimResult.rowsAffected === 0) {
          return errorResponse("Vote already processed");
        }

        // Re-check war involvement — a village may have entered a war during the voting window
        if (
          isVillageInvolvedInAnyWar(
            currentActiveWars,
            voteRecord.villageId,
            undefined,
            ["VILLAGE_WAR", "WAR_RAID"],
          ) ||
          isVillageInvolvedInAnyWar(currentActiveWars, voteRecord.targetId, undefined, [
            "VILLAGE_WAR",
            "WAR_RAID",
          ])
        ) {
          await Promise.all([
            updateVillageElderVoteForVoteOnWarDeclaration2(ctx.drizzle, input),
            insertNotificationForVoteOnWarDeclaration(
              ctx.drizzle,
              voteRecord,
              defenderVillage,
            ),
            incrementNotificationCounters(ctx.drizzle, [voteRecord.initiatedByUserId]),
          ]);
          return errorResponse("A village is already involved in an active war");
        }

        // Start the war and deduct tokens
        if (!attackerVillage) {
          await Promise.all([
            updateVillageElderVoteForVoteOnWarDeclaration2(ctx.drizzle, input),
            insertNotificationForVoteOnWarDeclaration2(
              ctx.drizzle,
              voteRecord,
              defenderVillage,
            ),
            incrementNotificationCounters(ctx.drizzle, [voteRecord.initiatedByUserId]),
          ]);
          return errorResponse("Village no longer has enough tokens to declare war");
        }
        const started = await startApprovedVoteWar(ctx.drizzle, input.voteId, {
          attackerVillageId: voteRecord.villageId,
          attackerVillageName: attackerVillage.name,
          defenderVillageId: voteRecord.targetId,
          defenderVillageName: defenderVillage?.name ?? "another village",
          defenderKageId: defenderVillage?.kageId,
          initiatedByUserId: voteRecord.initiatedByUserId,
          warType: voteRecord.warType ?? "VILLAGE_WAR",
          targetStructureRoute: voteRecord.targetStructureRoute ?? "/townhall",
        });
        if (!started) {
          await Promise.all([
            updateVillageElderVoteForVoteOnWarDeclaration2(ctx.drizzle, input),
            insertNotificationForVoteOnWarDeclaration3(
              ctx.drizzle,
              voteRecord,
              defenderVillage,
            ),
            incrementNotificationCounters(ctx.drizzle, [voteRecord.initiatedByUserId]),
          ]);
          return errorResponse(
            "War could not start: a village is already involved in a war or your village no longer has enough tokens.",
          );
        }
        return {
          success: true,
          message: "War declaration approved!",
        };
      }

      if (outcome === "REJECTED") {
        // Atomically claim the rejection to prevent double notifications on concurrent votes.
        // Set endsAt = now so the cooldown window starts from the real resolution time.
        const [claimResult, targetVillage] = await Promise.all([
          updateVillageElderVoteForCancelWarDeclaration(ctx.drizzle, input),
          findVillageForVoteOnWarDeclaration2(ctx.drizzle, voteRecord),
        ]);
        if (claimResult.rowsAffected === 0) {
          return {
            success: true,
            message: "War declaration vote already resolved",
          };
        }
        await Promise.all([
          insertNotificationForVoteOnWarDeclaration4(
            ctx.drizzle,
            voteRecord,
            targetVillage,
          ),
          incrementNotificationCounters(ctx.drizzle, [voteRecord.initiatedByUserId]),
        ]);
        return {
          success: true,
          message: "War declaration rejected by the elders",
        };
      }

      return {
        success: true,
        message: `Vote recorded. Current tally: ${freshEntries.filter((e) => e.vote === "YES").length} YES, ${freshEntries.filter((e) => e.vote === "NO").length} NO`,
      };
    }),
});

/**
 * Settle due wars and load accepted, unended allies and mercenaries. Build exclusive
 * mercenary assignments across all open wars before applying participation filters.
 * @param client - The database client
 * @param villageId - Optional village participation filter
 * @param userId - With villageId, filter by the player's effective allegiance instead
 * @returns The active wars
 */
export const fetchActiveWars = async (
  client: DrizzleClient,
  villageId?: string,
  userId?: string,
) => {
  // Include pending settlements so ended wars can finish their strategic writes.
  let activeWars: FetchActiveWarsReturnType[] = await listWarForFetchActiveWars(client);
  // Settle before filtering so expired appointments no longer exclude other wars.
  activeWars = await Promise.all(
    activeWars
      .filter((war) => war.attackerVillage && war.defenderVillage)
      .map((war) => handleWarEnd(war, client)),
  );
  // Resolve cross-war exclusivity before narrowing to a village or player.
  activeWars = withMercenaryParticipation(activeWars).filter(
    (war) =>
      war.status === "ACTIVE" &&
      (!villageId ||
        (userId
          ? !!getWarSide(war, villageId, userId)
          : isVillageInvolvedInAnyWar([war], villageId))),
  );

  return activeWars;
};

export type FetchActiveWarsReturnType = War & {
  warAllies: (WarAlly & { village: Village })[];
  warMercenaries?: import("@/drizzle/schema").WarMercenary[];
  mercenaryWarIds?: Record<string, string>;
  attackerVillage: Village & { structures: VillageStructure[] };
  defenderVillage: Village & { structures: VillageStructure[] };
};

export type GetActiveWarsReturnType = NonNullable<
  RouterOutputs["war"]["getActiveWars"]
>;

/**
 * Count non-AI members of the owning faction for Hideouts and Strongholds,
 * or ordinary residents for other village types.
 * @param client - The DrizzleClient instance
 * @param villageId - The ID of the village
 * @returns The member count used for declaration eligibility
 */
const getVillageMemberCount = async (
  client: DrizzleClient,
  villageId: string,
): Promise<number> => {
  const factionMembers = selectClanMemberCountForVillage(client, villageId);
  const residents = selectUserDataForGetVillageMemberCount2(client, villageId);
  const result = await selectVillageForGetVillageMemberCount(
    client,
    factionMembers,
    residents,
    villageId,
  );
  return result[0]?.count || 0;
};
