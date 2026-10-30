import { DUNGEON_FLOORS_PER_TIER } from "@/drizzle/constants";
import { dungeonContentSchema } from "@/validators/dungeon";
import type { DungeonBattleState } from "@/libs/dungeon";
/** Fresh validated one-tier definition shared by dungeon schema, router and combat tests. */
export const dungeonContent = () => dungeonContentSchema.parse({
  name: "Test dungeon", sector: 1, longitude: 10, latitude: 10, expiresAt: null, hidden: false,
  tiers: [Array.from({length: DUNGEON_FLOORS_PER_TIER}, (_, i) => ({kind: i === DUNGEON_FLOORS_PER_TIER - 1 ? "boss" : "floor", waves: [{aiIds: ["enemy"], delayRounds: 0}]}))],
  rewards: {money: 100, experience: 10, tokens: 5, prestige: 2},
});
/** Independent three-player battle snapshot with overridable wave/progress state for each test. */
export const dungeonBattleState = (overrides: Partial<DungeonBattleState> = {}): DungeonBattleState & { dungeonId: string; content: ReturnType<typeof dungeonContent> } => ({
  dungeonId: "definition", content: dungeonContent(),
  runId: "run", runVersion: 1, runState: {memberIds: ["a", "b", "c"], invitedIds: [], readyIds: [], floor: 0, clearedFloors: [], message: ""},
  totalFloors: DUNGEON_FLOORS_PER_TIER, roomKind: "floor", expiresAt: Date.now() + 3600000,
  lastActionRound: {a: 0, b: 0, c: 0}, ...overrides,
});

/** Opening-wave fixture with no queued enemies; tests add pending waves when needed. */
export const encounterWaveState = (): import("@/libs/combat/encounters").EncounterWaveState => ({ wave: 1, waveStartedRound: 0, pendingWaves: [] });
