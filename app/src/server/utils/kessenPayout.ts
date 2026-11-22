import {
  KESSEN_ACADEMY_GRADUATION_PACK_ID,
  KESSEN_ACADEMY_LESSON_RYO,
  KESSEN_CARD_SELL_VALUES,
  type KessenTier,
} from "@/drizzle/constants";
import type { KessenMatch, KessenNpcProgress, KessenProgress } from "@/drizzle/schema";
import {
  academyLessonsCompleted,
  completesAcademy,
  KESSEN_ACADEMY_FIRST_LESSON,
  KESSEN_ACADEMY_LESSON_KEYS,
} from "@/libs/kessen/academy";
import { catalogById } from "@/libs/kessen/deck";
import {
  type KessenNpc,
  npcDropPool,
  npcForbiddenPool,
  npcVariant,
} from "@/libs/kessen/npcs";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import {
  copiesByName,
  firstWinEarned,
  type OwnedCounts,
  outcomeFor,
  planMatchPayout,
  rewardEligibility,
  rollNpcDrop,
  standardLegendaries,
  unownedLegendaries,
  weeklyWinsFor,
} from "@/libs/kessen/rewards";
import { cardKeywords } from "@/libs/kessen/text";
import type { ObjectiveTrackerTaskInput } from "@/libs/quest";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  findKessenMatch,
  findKessenNpcProgressRows,
  findKessenProgress,
  listKessenRewardBadges,
  listKessenRewardTitles,
  updateKessenMatchResult,
  updateKessenNpcProgressForAscendedFirstWin,
  updateKessenNpcProgressForWin,
  updateKessenProgressForAcademyGraduation,
  updateKessenProgressForAcademyLesson,
  updateKessenProgressForRewardedMatch,
  updateKessenProgressSeenKeywords,
  updateUserDataForKessenPayout,
  upsertKessenNpcProgressForStandardWin,
} from "@/queries/kessen";
import { fetchUser } from "@/queries/profile";
import {
  fetchQuestTrackerState,
  insertUserBadgeForUpdateRewards,
} from "@/queries/quests";
import type { DrizzleClient } from "@/server/db";
import { grantUserItems, type ItemGrant } from "@/server/utils/itemGrants";
import { grantTitles } from "@/server/utils/titleGrants";
import { getUtcDayKey, periodStart } from "@/utils/time";
import type {
  KessenFirstWinChoice,
  KessenMatchResult,
  KessenSettlement,
  KessenStoredMatch,
} from "@/validators/kessen";

/**
 * Settles a match that ended through play, after its status CAS stored
 * `unsettledKessenResult` and the plan as `settlement`. It claims the daily caps and
 * first wins with guarded writes, writes the settled result (the version CAS that claims
 * the grants) and only then pays what the claims won. A claim this match already won
 * reads as its own on a rerun (the rewarded claim names the match, the NPC record keeps
 * the finish time), so `resumeKessenSettlement` can finish a match whose request died
 * part way. Null when another request wrote the settled result first.
 */
export const settleKessenPayout = async (
  input: SettleInput,
): Promise<SettleOutcome | null> => {
  const { client, plan, userId, match, now } = input;
  const claims = await claimKessenPayout(client, userId, match, plan);

  const result: KessenMatchResult = {
    ...plan.result,
    ...(plan.result.rewarded && !claims.rewarded
      ? {
          rewarded: false,
          reason: "Another match used today's reward first; this one was practice.",
          ryo: 0,
          drops: [],
          weeklyFirstWinPack: false,
        }
      : {}),
    firstWin: claims.firstWin ? plan.result.firstWin : null,
    lessonCompleted: claims.lesson,
    ...(plan.academy
      ? {
          ryo: claims.lesson ? plan.academy.ryo : 0,
          academy: {
            lesson: plan.academy.lesson,
            ryo: claims.lesson ? plan.academy.ryo : 0,
            graduationPackId: claims.graduation
              ? KESSEN_ACADEMY_GRADUATION_PACK_ID
              : null,
          },
        }
      : {}),
  };
  const grants: ItemGrant[] = [
    ...(claims.rewarded ? plan.rewardItems : []),
    ...(claims.firstWin ? plan.firstWinItems : []),
    ...(claims.graduation
      ? [{ itemId: KESSEN_ACADEMY_GRADUATION_PACK_ID, quantity: 1 }]
      : []),
  ];
  const ryo =
    (claims.rewarded ? plan.ryo : 0) + (claims.lesson ? (plan.academy?.ryo ?? 0) : 0);
  const badgeNames = claims.firstWin && plan.firstWinBadge ? [plan.firstWinBadge] : [];
  const titleNames = claims.firstWin && plan.firstWinTitle ? [plan.firstWinTitle] : [];
  const settledState: KessenStoredMatch = { ...input.state, result, settlement: null };

  const write = await updateKessenMatchResult(
    client,
    { id: match.id, userId, version: match.version },
    { state: settledState, rewarded: result.rewarded, now },
  );
  if (write.rowsAffected !== 1) return null;

  await Promise.all([
    ryo > 0 || input.questData
      ? updateUserDataForKessenPayout(client, userId, ryo, input.questData)
      : null,
    grants.length > 0 ? grantUserItems(client, userId, grants) : null,
    badgeNames.length > 0
      ? listKessenRewardBadges(client, userId, badgeNames).then((badges) =>
          badges.length > 0
            ? insertUserBadgeForUpdateRewards(client, badges, { userId })
            : null,
        )
      : null,
    titleNames.length > 0
      ? listKessenRewardTitles(client, userId, titleNames).then((titles) =>
          grantTitles(
            client,
            userId,
            titles.map((entry) => entry.id),
          ),
        )
      : null,
  ]);
  return { result, state: settledState, version: match.version + 1, ryo, grants };
};

/**
 * Finishes the payout of a FINISHED match that still carries its `settlement` (its
 * finishing request ended before writing the settled result) and returns the row as it
 * now stands; any other row is returned as it is.
 */
export const resumeKessenSettlement = async (
  client: DrizzleClient,
  row: KessenMatch,
): Promise<KessenMatch> => {
  const state = row.state as unknown as KessenStoredMatch;
  const plan = state.settlement;
  if (row.status !== "FINISHED" || !plan || !row.finishedAt) return row;
  const [questUser, questState] = plan.objective
    ? await Promise.all([
        fetchUser(client, row.userId),
        fetchQuestTrackerState(client, row.userId),
      ])
    : [null, null];
  const now = new Date();
  const settled = await settleKessenPayout({
    client,
    userId: row.userId,
    match: {
      id: row.id,
      npcKey: row.npcKey ?? "",
      version: row.version,
      finishedAt: row.finishedAt,
    },
    state,
    plan,
    questData: kessenObjectiveTrackers(
      kessenTrackerUser(questUser, questState),
      plan.objective,
    ),
    now,
  });
  if (!settled) {
    const [fresh] = await findKessenMatch(client, row.userId, row.id);
    return fresh ?? row;
  }
  return {
    ...row,
    rewarded: settled.result.rewarded,
    version: settled.version,
    state: settled.state as unknown as Record<string, unknown>,
    updatedAt: now,
  };
};

/**
 * The result the status CAS stores next to the settlement: the match's outcome with
 * nothing paid, until the settled result replaces it.
 */
export const unsettledKessenResult = (plan: KessenSettlement): KessenMatchResult => ({
  ...plan.result,
  rewarded: false,
  reason: "This match's reward is still being settled.",
  ryo: 0,
  drops: [],
  firstWin: null,
  weeklyFirstWinPack: false,
  lessonCompleted: false,
  academy: null,
});

/** The quest tracker snapshot `kessenObjectiveTrackers` reads, or null without one. */
export const kessenTrackerUser = (
  questUser: Awaited<ReturnType<typeof fetchUser>> | null,
  questState: Awaited<ReturnType<typeof fetchQuestTrackerState>> | null,
) =>
  questUser && questState
    ? ({
        ...questUser,
        questData: questState.questData,
        userQuests: questState.userQuests,
        completedQuests: questState.completedQuests,
      } as unknown as Parameters<typeof kessenObjectiveTrackers>[0])
    : null;

/**
 * The payout of a finished match from one snapshot: eligibility, caps, ryo, the seeded
 * drop roll, first-win rewards and the keywords it revealed. A quest challenge match
 * plans no reward, first win, Circuit record or `win_card_duel` event: its win pays only
 * the objective it was started for. Pure; the claims in `settleKessenPayout` decide
 * which parts are paid.
 */
export const planKessenFinish = (input: PlanInput): KessenSettlement => {
  const { stored, npc, now } = input;
  const engine = stored.engine;
  const winner = engine.result?.winner ?? null;
  const outcome = outcomeFor(winner);
  const lesson = stored.mode === "lesson";
  const challenge = !!stored.challenge;
  const win = outcome === "win";
  const dayKey = getUtcDayKey(now);
  const weekKey = getUtcDayKey(periodStart("weekly", now));
  const eligibility = rewardEligibility({
    outcome,
    endedBy: "play",
    durationMs: now.getTime() - input.startedAt.getTime(),
    plays: stored.plays,
  });
  const progress = input.progress;
  const payout = planMatchPayout({
    counters: progress
      ? {
          dayKey: progress.dayKey,
          rewarded: progress.rewardedToday,
          drops: progress.dropsToday,
          npcWins: progress.npcWinsToday ?? {},
        }
      : null,
    dayKey,
    npcKey: npc.key,
    tier: input.tier,
    outcome,
    eligibility,
    weeklyWins: weeklyWinsFor(progress ?? null, weekKey),
    lesson,
    challenge,
  });

  const pool = stored.pool;
  const lookup = catalogById(pool);
  const variant = lesson ? null : npcVariant(npc, stored.mode);
  let ryo = payout.ryo;
  const rewardItems: ItemGrant[] = [];
  const drops: KessenMatchResult["drops"] = [];
  if (payout.rewarded && payout.dropRoll && variant?.dropTable) {
    // Seeded by the match's hidden seed, which the player never sees, so a drop cannot
    // be predicted from the match id and fished for by restarting matches.
    const roll = rollNpcDrop({
      seed: `kessen-drop:${input.dropSeed}`,
      table: variant.dropTable,
      pool: npcDropPool(npc, pool),
      forbiddenPool: npcForbiddenPool(npc, pool),
      byName: copiesByName(input.owned, pool),
    });
    if (roll.card) {
      const card = roll.card.card;
      const sell = roll.card.surplus && progress?.autoSellSurplus === true;
      const soldFor = sell ? KESSEN_CARD_SELL_VALUES[card.rarity] : null;
      drops.push({
        itemId: card.id,
        rarity: card.rarity,
        forbidden: false,
        surplus: roll.card.surplus,
        soldFor,
      });
      if (soldFor !== null) ryo += soldFor;
    }
    // The Forbidden chance comes on top of the card roll.
    if (roll.forbidden) {
      drops.push({
        itemId: roll.forbidden.id,
        rarity: roll.forbidden.rarity,
        forbidden: true,
        surplus: false,
        soldFor: null,
      });
    }
    for (const drop of drops)
      if (drop.soldFor === null) rewardItems.push({ itemId: drop.itemId, quantity: 1 });
  }
  if (payout.weeklyFirstWin)
    rewardItems.push({ itemId: KESSEN_PACK_IDS.paper, quantity: 1 });

  let firstWin: KessenMatchResult["firstWin"] = null;
  let firstWinItems: ItemGrant[] = [];
  let firstWinBadge: string | null = null;
  let firstWinTitle: string | null = null;
  let academy: KessenSettlement["academy"] = null;
  if (lesson) {
    const key = stored.lesson ?? KESSEN_ACADEMY_FIRST_LESSON;
    const completed = academyLessonsCompleted(progress?.academy);
    const first = win && !completed.includes(key);
    academy = {
      lesson: key,
      first,
      ryo: first ? KESSEN_ACADEMY_LESSON_RYO : 0,
      graduation: first && completesAcademy(key, completed),
    };
    // The first lesson leads on to the one-time starter choice.
    if (first && key === KESSEN_ACADEMY_FIRST_LESSON) {
      firstWin = { itemIds: [], choice: { kind: "starterFaction" } };
    }
  } else if (variant && !challenge && firstWinEarned(outcome, "play")) {
    const claimed =
      stored.mode === "ascended"
        ? input.npcProgress?.ascendedFirstWinAt
        : input.npcProgress?.firstWinAt;
    if (!claimed) {
      const reward = variant.firstWin;
      firstWinItems = reward.items.map((entry) => ({ ...entry }));
      firstWinBadge = reward.badge ?? null;
      firstWinTitle = reward.title ?? null;
      const choice = reward.choice;
      firstWin = {
        itemIds: firstWinItems.map((entry) => entry.itemId),
        choice:
          choice?.kind === "items"
            ? { kind: "items", options: [...choice.itemIds], claimed: null }
            : choice?.kind === "unownedLegendary"
              ? legendaryChoice(pool, input.owned)
              : null,
      };
    }
  }

  const seen = new Set(progress?.seenKeywords ?? []);
  for (const card of Object.values(engine.cards)) {
    for (const keyword of cardKeywords(lookup[card.id]?.abilities ?? card.abilities))
      seen.add(keyword);
  }

  return {
    lesson,
    challenge,
    academy,
    mode: stored.mode,
    win,
    dayKey,
    weekKey,
    dropRoll: payout.dropRoll,
    ryo,
    rewardItems,
    firstWinItems,
    firstWinBadge,
    firstWinTitle,
    seenKeywords: [...seen].sort(),
    objective:
      win && eligibility.eligible && !lesson && !challenge
        ? { npcKey: npc.key, tier: input.tier }
        : null,
    result: {
      winner,
      rewarded: payout.rewarded,
      reason: payout.reason,
      ryo: payout.rewarded ? ryo : (academy?.ryo ?? 0),
      drops,
      firstWin,
      weeklyFirstWinPack: payout.weeklyFirstWin,
      lessonCompleted: academy?.first === true,
      academy: academy
        ? {
            lesson: academy.lesson,
            ryo: academy.ryo,
            graduationPackId: academy.graduation
              ? KESSEN_ACADEMY_GRADUATION_PACK_ID
              : null,
          }
        : null,
    },
  };
};

/**
 * Quest trackers after a Kessen win, or undefined when no active objective can advance:
 * an unchanged snapshot is never written back over concurrent tracker updates. A ranked
 * duel win has the content id `ranked` and no tier, so it counts for objectives that
 * name no NPC and accept any tier (or name `ranked`).
 */
export const kessenObjectiveTrackers = (
  trackerUser: Parameters<typeof getNewTrackers>[0] | null,
  objective: { npcKey: string; tier: KessenTier | null } | null,
) => {
  if (!trackerUser || !objective) return undefined;
  const advances = trackerUser.userQuests.some((entry) =>
    entry.quest?.content?.objectives?.some((candidate) => {
      if (candidate.task !== "win_card_duel") return false;
      const goal = trackerUser.questData
        ?.find((tracker) => tracker.id === entry.questId)
        ?.goals.find((g) => g.id === candidate.id);
      return !goal?.done;
    }),
  );
  if (!advances) return undefined;
  const task: ObjectiveTrackerTaskInput = {
    task: "win_card_duel",
    increment: 1,
    contentId: objective.npcKey,
    duelTier: objective.tier ?? undefined,
  };
  const { trackers } = getNewTrackers(trackerUser, [task]);
  return filterQuestTrackersForDbPersist(trackers, trackerUser, true);
};

/**
 * Runs the guarded claims of a settlement and reports which ones this match holds. A
 * claim that does not land now may have landed in an earlier run of the same
 * settlement; the records show that by the match id (rewarded claim) or the finish time
 * (first win), so a rerun neither claims twice nor loses what it claimed.
 */
const claimKessenPayout = async (
  client: DrizzleClient,
  userId: string,
  match: SettleInput["match"],
  plan: KessenSettlement,
) => {
  const { npcKey, finishedAt } = match;
  const academy = plan.academy;
  const lessonWanted = plan.lesson && plan.win && academy?.first === true;
  const rewarded = plan.result.rewarded && !plan.lesson;
  const firstWinPlanned = plan.result.firstWin !== null;
  const [progressWrite, npcWrite] = await Promise.all([
    lessonWanted && academy
      ? updateKessenProgressForAcademyLesson(client, {
          userId,
          lesson: academy.lesson,
          matchId: match.id,
          seenKeywords: plan.seenKeywords,
        })
      : rewarded
        ? updateKessenProgressForRewardedMatch(client, {
            matchId: match.id,
            userId,
            dayKey: plan.dayKey,
            weekKey: plan.weekKey,
            npcKey,
            win: plan.win,
            dropRoll: plan.dropRoll,
            weeklyFirstWin: plan.result.weeklyFirstWinPack,
            seenKeywords: plan.seenKeywords,
          })
        : updateKessenProgressSeenKeywords(client, userId, plan.seenKeywords),
    !plan.win || plan.lesson || plan.challenge
      ? null
      : plan.mode === "ascended"
        ? updateKessenNpcProgressForAscendedFirstWin(client, userId, npcKey, finishedAt)
        : upsertKessenNpcProgressForStandardWin(client, userId, npcKey, finishedAt),
    plan.win && plan.mode === "ascended" && !plan.challenge
      ? updateKessenNpcProgressForWin(client, userId, npcKey, finishedAt)
      : null,
  ]);
  const firstWinWanted = !plan.lesson && plan.win && firstWinPlanned;
  const held = {
    rewarded: rewarded && progressWrite.rowsAffected === 1,
    lesson: lessonWanted && progressWrite.rowsAffected === 1,
    firstWin: firstWinWanted && npcWrite?.rowsAffected === 1,
    graduation: false,
  };
  if (
    (rewarded && !held.rewarded) ||
    (lessonWanted && !held.lesson) ||
    (firstWinWanted && !held.firstWin)
  ) {
    const [progressRows, npcRows] = await Promise.all([
      findKessenProgress(client, userId),
      plan.lesson ? [] : findKessenNpcProgressRows(client, userId, npcKey),
    ]);
    const progress = progressRows[0];
    const record = npcRows[0];
    const claimedAt =
      plan.mode === "ascended" ? record?.ascendedFirstWinAt : record?.firstWinAt;
    held.rewarded ||= rewarded && progress?.rewardedMatchId === match.id;
    held.lesson ||=
      lessonWanted && !!academy && progress?.academy?.[academy.lesson] === match.id;
    held.firstWin ||= firstWinWanted && claimedAt?.getTime() === finishedAt.getTime();
  }
  // The graduation claim reads the lesson this match just recorded, so it runs after it.
  // It names the match, so a rerun recognises a pack this match already claimed.
  if (held.lesson && academy) {
    const graduation = await updateKessenProgressForAcademyGraduation(client, {
      userId,
      matchId: match.id,
      lessons: KESSEN_ACADEMY_LESSON_KEYS,
    });
    held.graduation = graduation.rowsAffected === 1;
    if (!held.graduation && academy.graduation) {
      const [progress] = await findKessenProgress(client, userId);
      held.graduation = progress?.academyGraduatedMatchId === match.id;
    }
  }
  return {
    rewarded: held.rewarded,
    lesson: held.lesson,
    firstWin: plan.lesson ? held.lesson : held.firstWin,
    graduation: held.graduation,
  };
};

/**
 * Unmeishi's first-win pick: a standard legendary the player owns no copy of or, once
 * they own every one, any standard legendary (a plain pick, the card is a further copy);
 * no pick when the catalog has no legendary to offer.
 */
const legendaryChoice = (
  pool: KessenStoredMatch["pool"],
  owned: OwnedCounts,
): KessenFirstWinChoice | null => {
  const unowned = unownedLegendaries(pool, owned);
  if (unowned.length > 0)
    return {
      kind: "unownedLegendary",
      options: unowned.map((card) => card.id),
      claimed: null,
    };
  const all = standardLegendaries(pool);
  return all.length > 0
    ? { kind: "items", options: all.map((card) => card.id), claimed: null }
    : null;
};

interface PlanInput {
  /** The match's hidden seed (`KessenMatch.seed`); never the client-visible match id. */
  dropSeed: string;
  npc: KessenNpc;
  tier: KessenTier;
  stored: KessenStoredMatch;
  startedAt: Date;
  now: Date;
  progress: KessenProgress | null;
  npcProgress: KessenNpcProgress | null;
  /** Owned copies per item id, including copies listed in the auction house. */
  owned: OwnedCounts;
}

interface SettleInput {
  client: DrizzleClient;
  userId: string;
  /**
   * The finished match after its status CAS (`version` is the new version); its finish
   * time is the time the NPC record keeps for its wins.
   */
  match: { id: string; npcKey: string; version: number; finishedAt: Date };
  /** The state the status CAS stored, with its `settlement`. */
  state: KessenStoredMatch;
  plan: KessenSettlement;
  questData: ReturnType<typeof kessenObjectiveTrackers>;
  /** When the settled result is written. */
  now: Date;
}

interface SettleOutcome {
  result: KessenMatchResult;
  state: KessenStoredMatch;
  version: number;
  ryo: number;
  grants: ItemGrant[];
}
