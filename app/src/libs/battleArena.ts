import { RANKED_DIVISIONS } from "@/drizzle/constants";
import type { UserData, UserQuest } from "@/drizzle/schema";
import type { ObjectiveTrackerType } from "@/validators/objectives";

/** Arena modes, named as their URL hashes (`/battlearena#PVP%20Rank`). */
export const ARENA_MODES = [
  "Arena",
  "Sparring",
  "Training",
  "PVP Rank",
  "Battle Pyramid",
] as const;
export type ArenaMode = (typeof ARENA_MODES)[number];

/** Short tab labels for each mode. */
export const ARENA_MODE_LABELS: Record<ArenaMode, string> = {
  Arena: "Arena",
  Sparring: "Sparring",
  Training: "Training",
  "PVP Rank": "Ranked",
  "Battle Pyramid": "Pyramid",
};

/** The mode a URL hash names, or null for the overview and unknown or malformed hashes. */
export const arenaModeFromHash = (hash: string): ArenaMode | null => {
  try {
    const name = decodeURIComponent(hash.replace(/^#/, ""));
    return ARENA_MODES.find((mode) => mode === name) ?? null;
  } catch {
    return null;
  }
};

/** Progress on the first active quest objective that asks for spar wins. */
export const sparExamProgress = (user: {
  userQuests: Pick<UserQuest, "endAt" | "quest">[];
  questData?:
    | { id: string; goals: Pick<ObjectiveTrackerType, "id" | "value" | "done">[] }[]
    | null;
}): { questName: string; done: number; target: number } | null => {
  for (const userQuest of user.userQuests) {
    if (!userQuest.quest || userQuest.endAt) continue;
    const tracker = user.questData?.find((entry) => entry.id === userQuest.quest.id);
    for (const objective of userQuest.quest.content.objectives) {
      if (objective.task !== "spars_won") continue;
      const goal = tracker?.goals.find((entry) => entry.id === objective.id);
      if (goal?.done) continue;
      const target = "value" in objective ? Number(objective.value) : 1;
      return {
        questName: userQuest.quest.name,
        done: Math.min(goal?.value ?? 0, target),
        target,
      };
    }
  }
  return null;
};

/** The division an LP total reaches and how far the next one is; the top division has no LP mark. */
export const rankedProgress = (
  lp: number,
): { division: string; nextDivision: string | null; toNext: number | null } => {
  const reachedIndex = RANKED_DIVISIONS.reduce(
    (found, division, index) => (lp >= division.rankedLp ? index : found),
    0,
  );
  const next = RANKED_DIVISIONS[reachedIndex + 1];
  return {
    division: RANKED_DIVISIONS[reachedIndex]?.name ?? "Unranked",
    nextDivision: next?.name ?? null,
    toNext: next && Number.isFinite(next.rankedLp) ? next.rankedLp - lp : null,
  };
};

const DUMMY_STATS = [
  "defence",
  "strength",
  "speed",
  "intelligence",
  "willpower",
] as const;
type DummyStat = (typeof DUMMY_STATS)[number];
export type DummyStats = Record<DummyStat, number>;
export type DummyPreset = "Minimum" | "Like me" | "Maximum" | "Custom";

/** Training dummy stats for a preset, kept between `min` and each stat's maximum. */
export const dummyPresetValues = (
  preset: Exclude<DummyPreset, "Custom">,
  user: Pick<UserData, DummyStat>,
  maxValues: Partial<Record<string, number>>,
  min: number,
): DummyStats =>
  Object.fromEntries(
    DUMMY_STATS.map((stat) => {
      const max = maxValues[stat] ?? min;
      const value =
        preset === "Minimum" ? min : preset === "Maximum" ? max : user[stat];
      return [stat, Math.min(max, Math.max(min, Math.round(value)))];
    }),
  ) as DummyStats;

/** The preset that produces exactly these values, or "Custom". */
export const matchDummyPreset = (
  values: Partial<Record<DummyStat, number>>,
  user: Pick<UserData, DummyStat>,
  maxValues: Partial<Record<string, number>>,
  min: number,
): DummyPreset =>
  (["Like me", "Minimum", "Maximum"] as const).find((preset) => {
    const expected = dummyPresetValues(preset, user, maxValues, min);
    return DUMMY_STATS.every((stat) => Number(values[stat]) === expected[stat]);
  }) ?? "Custom";

export type TowerState =
  | { kind: "climbing" }
  | { kind: "open" }
  | { kind: "busy"; climbing: string }
  | { kind: "missingItems"; missing: number };

/** Whether a tower can be climbed now: climbing it, busy with another, short of entry items, or open. */
export const towerState = (
  tower: { id: string; entryRequirements: { quantity: number; owned: number }[] },
  activeTower: { id: string; name: string } | null,
): TowerState => {
  if (activeTower?.id === tower.id) return { kind: "climbing" };
  if (activeTower) return { kind: "busy", climbing: activeTower.name };
  const missing = tower.entryRequirements.reduce(
    (sum, required) => sum + Math.max(0, required.quantity - required.owned),
    0,
  );
  return missing > 0 ? { kind: "missingItems", missing } : { kind: "open" };
};
