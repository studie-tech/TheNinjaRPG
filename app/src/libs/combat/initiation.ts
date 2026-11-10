/** Battle initiation phases that work on the preloaded snapshot and write nothing. */
import { nanoid } from "nanoid";
import {
  CombatStatNames,
  ELITE_JONIN_BRACKET,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  REGEN_SECONDS,
} from "@/drizzle/constants";
import type { GameSetting, RankedLoadout, VillageAlliance } from "@/drizzle/schema";
import type {
  BattleUserState,
  CombatQueryUser,
  GroundEffect,
} from "@/libs/combat/types";
import { inertUserItemColumns } from "@/libs/combat/util";
import type { CoopEncounter } from "@/libs/coop";
import {
  anonymousSpriteAppearance,
  resolveSpriteAppearance,
} from "@/libs/lpc/appearance";
import { getWarRelationship, isWarMercenary } from "@/libs/objectiveWar";
import {
  calcActiveUserRegen,
  calcMaxEnergy,
  canAttackBracket,
  getExpBracket,
} from "@/libs/profile";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { projectPartyTracker, questPartyHelperAttemptId } from "@/libs/questParty";
import { getTimedRegenerationGain } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import { applyMasteryTrainingGains, settleQueuedTraining } from "@/libs/train";
import { isOnVillageDuty, villageDutyActorId } from "@/libs/villageDuty";
import type {
  fetchBattleEssentials,
  listUserDataForQueryBattleUsers,
  listUserItemForInitiateBattle,
} from "@/queries/combat";
import type { listItemsByIds } from "@/queries/item";
import type { listJutsuByIds } from "@/queries/jutsu";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { findRelationship } from "@/utils/alliance";
import { getRandomElement } from "@/utils/array";
import { regenTicksSince, secondsFromDate } from "@/utils/time";
import { BarrierTag } from "@/validators/combat";

type BattleParticipant = Awaited<
  ReturnType<typeof listUserDataForQueryBattleUsers>
>[number];
type ForcedItems = Awaited<ReturnType<typeof listItemsByIds>>;
type ForcedJutsus = Awaited<ReturnType<typeof listJutsuByIds>>;
type ForcedItemProgression = Awaited<ReturnType<typeof listUserItemForInitiateBattle>>;
type OpenWar = Awaited<ReturnType<typeof fetchBattleEssentials>>["activeWars"][number];

/** Queued training settled from a participant snapshot, committed by the battle claim. */
export type QueuedBattleTraining = ReturnType<
  typeof settleQueuedBattleTraining
>[number];

/**
 * Project a quest party's shared tracker onto its members, giving helpers without the quest
 * a stand-in attempt. Returns the reason a member can no longer join.
 */
export const projectQuestParty = (
  participants: BattleParticipant[],
  party: Extract<CoopEncounter, { kind: "quest" }>,
  location: { sector?: number; longitude?: number; latitude?: number },
) => {
  for (const participant of participants) {
    if (
      participant.questPartyId !== party.id ||
      participant.sector !== location.sector ||
      participant.longitude !== location.longitude ||
      participant.latitude !== location.latitude
    )
      return "Quest team membership or location changed";
    if (
      !participant.userQuests.some((entry) => entry.questId === party.quest.id) &&
      !participant.completedQuests.some((entry) => entry.questId === party.quest.id)
    )
      return "A team member no longer has this quest";
    const personal = participant.questData?.find(
      (entry) => entry.id === party.quest.id,
    );
    participant.questData = [
      ...(participant.questData ?? []).filter((entry) => entry.id !== party.quest.id),
      projectPartyTracker({ id: party.id, tracker: party.tracker }, personal),
    ];
    if (!participant.userQuests.some((entry) => entry.questId === party.quest.id))
      participant.userQuests.push({
        id: questPartyHelperAttemptId(party.id),
        userId: participant.userId,
        questId: party.quest.id,
        questType: party.quest.questType,
        startedAt: new Date(party.tracker.startAt),
        endAt: null,
        completed: 0,
        previousCompletes: 0,
        previousAttempts: 0,
        periodCompletes: 0,
        periodStartAt: null,
        pendingRewardChoice: null,
        entryPaid: false,
        isolated: false,
        questVersion: null,
        quest: structuredClone(party.quest),
      });
  }
  return undefined;
};

/**
 * Settle due queued training on the participant snapshots, as an account refresh would.
 * `energyCapacity` follows mastery completions that unlock worn capacity gear.
 * Tournament games settle every human so their real pool recovery survives the exhibition.
 */
export const settleQueuedBattleTraining = (
  participants: BattleParticipant[],
  settings: GameSetting[],
  energyCapacity: Record<string, number>,
  isTournamentGame: boolean,
) =>
  participants.flatMap((user) => {
    if (
      user.isAi ||
      (!isTournamentGame &&
        user.queue.length === 0 &&
        !user.currentlyTrainingMastery &&
        !user.currentlyTrainingElement)
    )
      return [];
    const original = { ...user };
    const ticks = regenTicksSince(user.regenAt);
    const trainingUser = {
      ...user,
      // Existing training keeps its earned Energy when the next isolated floor starts.
      status: "AWAKE" as const,
      regeneration: calcActiveUserRegen(user, settings),
      maxEnergy: calcMaxEnergy(user),
    } as unknown as NonNullable<UserWithRelations>;
    const regenerationGain = (fromTick: number, toTick: number) =>
      getTimedRegenerationGain(
        calcActiveUserRegen(user, settings, false),
        regenerationBuffs(user),
        new Date(user.regenAt.getTime() + fromTick * REGEN_SECONDS * 1000),
        toTick - fromTick,
        REGEN_SECONDS,
      );
    const { energy, mastery } = settleQueuedTraining(
      trainingUser,
      user.queue,
      settings,
      ticks,
      new Date(),
      regenerationGain,
    );
    if (!energy && !mastery && !isTournamentGame) return [];
    const amount = energy?.completed.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
    const minutes =
      mastery?.completed.reduce((sum, entry) => sum + entry.minutes, 0) ?? 0;
    if (energy) {
      for (const stat of CombatStatNames) user[stat] += energy.gains[stat] ?? 0;
      user.experience = Math.round(user.experience + amount);
      user.curEnergy = energy.curEnergy;
      user.energyQueueHead = energy.head;
    }
    if (mastery) {
      Object.assign(user, applyMasteryTrainingGains(user, mastery.gains));
      Object.assign(user, mastery.update);
      // Completion can make already worn Energy capacity gear eligible before loadouts change.
      energyCapacity[user.userId] = calcMaxEnergy(user);
    }
    const tasks = [
      ...(amount > 0 ? [{ task: "stats_trained" as const, increment: amount }] : []),
      ...(minutes > 0
        ? [{ task: "minutes_training" as const, increment: minutes }]
        : []),
    ];
    if (tasks.length > 0) {
      user.questData = filterQuestTrackersForDbPersist(
        getNewTrackers(user as unknown as NonNullable<UserWithRelations>, tasks)
          .trackers,
        user,
        true,
      );
    }
    return [
      {
        original,
        user,
        energy,
        mastery,
        amount,
        regen: regenerationGain(0, ticks),
        regenAt: secondsFromDate(ticks * REGEN_SECONDS, original.regenAt),
      },
    ];
  });

/** Overwrite forced participants' items and jutsus with their fixed loadouts. */
export const applyForcedLoadouts = (
  participants: BattleParticipant[],
  forceLoadouts: RankedLoadout[],
  loadoutItems: ForcedItems,
  loadoutJutsus: ForcedJutsus,
  progression: ForcedItemProgression,
) => {
  // Prefer equipped copies, then highest level — includes unequipped ownership.
  const progressionQueues = new Map<string, ForcedItemProgression[number][]>();
  for (const row of progression) {
    const key = `${row.userId}:${row.itemId}`;
    const queue = progressionQueues.get(key) ?? [];
    queue.push(row);
    progressionQueues.set(key, queue);
  }
  for (const queue of progressionQueues.values()) {
    queue.sort((a, b) => {
      const aEquipped = a.equipped !== "NONE" ? 1 : 0;
      const bEquipped = b.equipped !== "NONE" ? 1 : 0;
      if (aEquipped !== bEquipped) return bEquipped - aEquipped;
      if (a.level !== b.level) return b.level - a.level;
      return b.experience - a.experience;
    });
  }

  for (const user of participants) {
    const userLoadout = forceLoadouts.find((l) => l.userId === user.userId);
    if (userLoadout) {
      user.items = loadoutItems
        .filter((item) =>
          [userLoadout.loadout.weaponIds, userLoadout.loadout.consumableIds]
            .flat()
            .includes(item.id),
        )
        .map((item) => {
          const owned =
            progressionQueues.get(`${user.userId}:${item.id}`)?.shift() ?? null;
          return {
            ...inertUserItemColumns(user.userId, new Date()),
            // Synthetic id so battle-end quantity/durability writes never touch
            // real inventory rows; XP is credited via progressionRowId instead.
            id: nanoid(),
            progressionRowId: owned?.id ?? null,
            itemId: item.id,
            quantity: 1,
            level: owned?.level ?? 1,
            experience: owned?.experience ?? 0,
            equipped: "ITEM_1" as const,
            item: { ...item, variants: owned?.item?.variants ?? [] },
            activeVariantId: owned?.activeVariantId ?? null,
            imbuements: [],
            dropChancePerc: 0,
            durability: 100,
          };
        });
      user.jutsus = loadoutJutsus
        .filter((jutsu) => userLoadout.loadout.jutsuIds.includes(jutsu.id))
        .map((jutsu) => ({
          id: nanoid(),
          createdAt: new Date(),
          updatedAt: new Date(),
          userId: user.userId,
          jutsuId: jutsu.id,
          level: 25,
          experience: 0,
          equipped: true,
          trainingStartedAt: null,
          finishTraining: null,
          jutsu: jutsu,
          reskinId: null,
          activeReskin: null,
        }));
    }
  }
};

/** Why a human attacker may not start open-world combat against these targets. */
export const getAttackRestriction = ({
  user,
  isLeadAttacker,
  targets,
  activeWars,
  relations,
  now,
}: {
  user: BattleParticipant;
  /** Bracket rules follow the initiating player; village rules cover the whole team. */
  isLeadAttacker: boolean;
  targets: BattleParticipant[];
  activeWars: OpenWar[];
  relations: VillageAlliance[];
  now: Date;
}) => {
  // Elite bracket limits remain absolute before war-zone, war and immunity exemptions.
  const eliteMismatch =
    isLeadAttacker &&
    targets.find(
      (target) =>
        (user.rank === "ELITE JONIN" || target.rank === "ELITE JONIN") &&
        !canAttackBracket(
          getExpBracket(user.experience, user.rank),
          getExpBracket(target.experience, target.rank),
        ),
    );
  if (eliteMismatch)
    return `Elite Jonin can only fight players in brackets ${ELITE_JONIN_BRACKET - 1} and ${ELITE_JONIN_BRACKET}.`;
  // War-Torn sectors skip ordinary village and XP bracket restrictions.
  const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
  if (!isInWarTornSector) {
    if (targets.some((t) => getWarRelationship(activeWars, user, t) === "ALLY"))
      return "Cannot attack a participant on your war side";
    // Guard 1: Cannot attack members of your own village
    const sameVillageTarget = targets.find(
      (t) =>
        t.villageId !== null &&
        t.villageId === user.villageId &&
        getWarRelationship(activeWars, user, t) !== "ENEMY",
    );
    if (sameVillageTarget) {
      return `Cannot attack ${sameVillageTarget.username} — they are in your village`;
    }

    // Guard 2: Cannot attack members of allied villages
    const alliedTarget = targets.find(
      (t) =>
        (getWarRelationship(activeWars, user, t) ??
          findRelationship(relations, user.villageId, t.villageId)?.status) === "ALLY",
    );
    if (alliedTarget) {
      return `Cannot attack ${alliedTarget.username} — their village is allied with yours`;
    }

    // Guard 3: Bracket restrictions
    const attackerBracket = getExpBracket(user.experience, user.rank);

    // Collect targets more than one bracket below — protection is one-directional:
    // attackers may hit same bracket, higher, or one below (without exemption).
    // Lower-bracket players may freely attack higher-bracket players.
    // Academy/Genin remain blocked by the rank restrictions above.
    const crossBracketTargets = isLeadAttacker
      ? targets.filter(
          (t) =>
            !canAttackBracket(attackerBracket, getExpBracket(t.experience, t.rank)),
        )
      : [];

    if (crossBracketTargets.length > 0) {
      const attackerIsWarParticipant = user.warParticipantUntil > now;

      // Each cross-bracket target needs its own exemption — check individually
      const blockedTarget = crossBracketTargets.find((t) => {
        // Guard 4 (allow): target's bracket immunity is lifted (they attacked recently)
        if (t.bracketImmunityLiftedUntil > now) return false;

        // Guard 5 (allow): both are active war participants on opposing sides.
        // Effective allegiance includes allied villages and exclusive mercenary appointments.
        const targetIsWarParticipant = t.warParticipantUntil > now;
        const atWar = getWarRelationship(activeWars, user, t) === "ENEMY";
        if (
          (attackerIsWarParticipant || isWarMercenary(activeWars, user.userId)) &&
          (targetIsWarParticipant || isWarMercenary(activeWars, t.userId)) &&
          atWar
        )
          return false;

        return true; // no exemption — this target is blocked
      });

      if (blockedTarget) {
        const targetBracket = getExpBracket(
          blockedTarget.experience,
          blockedTarget.rank,
        );
        return `Cannot attack ${blockedTarget.username} — different combat bracket (${attackerBracket} vs ${targetBracket})`;
      }
    }
  }
  return undefined;
};

/** Scatter barriers over the free tiles, spending one roll per tile and one per barrier. */
export const rollStartingGroundEffects = (
  assets: { id: string; type: string }[],
  gridSize: { width: number; height: number },
  usersState: BattleUserState[],
) => {
  const groundEffects: GroundEffect[] = [];
  const groundAssets = assets.filter((a) => a.type === "STATIC");
  for (let col = 0; col < gridSize.width; col++) {
    for (let row = 0; row < gridSize.height; row++) {
      // Ignore the spots where we placed users
      const foundUser = usersState.find(
        (u) => u.longitude === col && u.latitude === row,
      );
      if (!foundUser) {
        const rand = Math.random();
        if (rand < 0.1) {
          const asset = getRandomElement(groundAssets);
          if (asset) {
            const tag: GroundEffect = {
              ...BarrierTag.parse({
                power: 2,
                staticAssetPath: asset.id,
              }),
              id: `initial-${col}-${row}`,
              creatorId: "ground",
              actionId: "initial",
              createdRound: 0,
              level: 0,
              longitude: col,
              latitude: row,
              isNew: false,
              barrierAbsorb: 0,
              castThisRound: false,
            };
            groundEffects.push(tag);
          }
        }
      }
    }
  }
  return groundEffects;
};

/** Training history rows for the participants whose claim landed. */
export const buildQueuedTrainingLogs = (claimed: QueuedBattleTraining[]) =>
  claimed.flatMap((entry) => [
    ...(entry.energy?.completed ?? []).map((completed) => ({
      userId: entry.user.userId,
      stat: completed.stat,
      amount: completed.amount,
      speed: entry.original.trainingSpeed,
      trainingFinishedAt: new Date(),
    })),
    ...(entry.mastery?.completed ?? []).map((completed) => ({
      userId: entry.user.userId,
      stat: completed.stat,
      amount: completed.amount,
      speed: completed.speed,
      trainingFinishedAt: completed.finishedAt,
    })),
  ]);

/** Snapshot an enrolled character as an isolated AI template before any settlement or participant claims. */
export const prepareVillageDutyDefender = (
  participant: BattleParticipant,
  villageId: string,
):
  | (BattleParticipant &
      Pick<CombatQueryUser, "isVillageDutyCopy"> &
      Pick<BattleUserState, "spriteAppearance">)
  | undefined => {
  if (!isOnVillageDuty(participant, villageId)) return undefined;
  const copy = structuredClone(participant);
  const masked = !!copy.anbuId;
  return {
    ...copy,
    userId: villageDutyActorId(copy.userId),
    username: masked ? "ANBU Protector" : copy.username,
    isAi: true,
    isVillageDutyCopy: true,
    status: "AWAKE",
    battleId: null,
    sector: copy.village?.sector ?? copy.sector,
    curHealth: copy.maxHealth,
    curChakra: copy.maxChakra,
    curStamina: copy.maxStamina,
    // Exclude active jobs, pets and reward sources; quest history stays until loadout gating finishes.
    activePetId: null,
    petTask: null,
    queue: [],
    cookingJobs: [],
    bounties: [],
    bountySignups: [],
    raidBuffs: [],
    items: copy.items.map((item) => ({
      ...item,
      id: `duty:${item.id}`,
      userId: villageDutyActorId(copy.userId),
      dropChancePerc: 0,
    })),
    ...(masked
      ? {
          avatar: copy.anbuSquad?.image ?? copy.avatar,
          avatarLight: copy.anbuSquad?.image ?? copy.avatarLight,
        }
      : {}),
    // AI templates keep this recipe through processUsersForBattle, without reading their owner again.
    spriteAppearance: masked
      ? anonymousSpriteAppearance(true)
      : resolveSpriteAppearance(copy),
  };
};
