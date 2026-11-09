import { DUNGEON_FLOORS_PER_TIER } from "@/drizzle/constants";
import { dungeon, dungeonRun } from "@/drizzle/schema";
import type { DungeonBattleState } from "@/libs/dungeon";
import { dungeonContentSchema } from "@/validators/dungeon";
import { getTestDatabase } from "./testDatabase";

type Waves = ReturnType<typeof dungeonContent>["tiers"][number][number]["waves"];

/** Fresh validated one-tier definition shared by dungeon schema, router and combat tests. */
export const dungeonContent = () =>
  dungeonContentSchema.parse({
    name: "Test dungeon",
    sector: 1,
    longitude: 10,
    latitude: 10,
    expiresAt: null,
    hidden: false,
    tiers: [
      Array.from({ length: DUNGEON_FLOORS_PER_TIER }, (_, i) => ({
        kind: i === DUNGEON_FLOORS_PER_TIER - 1 ? "boss" : "floor",
        waves: [{ aiIds: ["enemy"], delayRounds: 0 }],
      })),
    ],
    rewards: { money: 100, experience: 10, tokens: 5, prestige: 2 },
  });
/** Independent three-player battle snapshot with overridable wave/progress state for each test. */
export const dungeonBattleState = (
  overrides: Partial<DungeonBattleState> = {},
): DungeonBattleState & {
  dungeonId: string;
  content: ReturnType<typeof dungeonContent>;
} => ({
  dungeonId: "definition",
  content: dungeonContent(),
  runId: "run",
  runVersion: 1,
  runState: {
    memberIds: ["a", "b", "c"],
    invitedIds: [],
    readyIds: [],
    floor: 0,
    clearedFloors: [],
    message: "",
  },
  totalFloors: DUNGEON_FLOORS_PER_TIER,
  roomKind: "floor",
  expiresAt: Date.now() + 3600000,
  lastActionRound: { a: 0, b: 0, c: 0 },
  ...overrides,
});

/** Opening-wave fixture with no queued enemies; tests add pending waves when needed. */
export const encounterWaveState =
  (): import("@/libs/combat/encounters").EncounterWaveState => ({
    wave: 1,
    waveStartedRound: 0,
    pendingWaves: [],
  });

/** A fighting run on a fresh definition, plus the `coop` input that admits `members` to `battleId`. */
export const insertFightingDungeonRun = async ({
  dungeonId,
  battleId,
  members,
  waves,
  requiredItemId = null,
}: {
  dungeonId: string;
  battleId: string;
  members: string[];
  waves: Waves;
  requiredItemId?: string | null;
}) => {
  const client = await getTestDatabase();
  const meta = dungeonBattleState({
    runState: { ...dungeonBattleState().runState, memberIds: members },
  });
  const content = dungeonContent();
  content.tiers[0]![0]!.waves = waves;
  content.requirements.requiredItemId = requiredItemId;
  await client
    .insert(dungeon)
    .values({ id: dungeonId, content, updatedAt: new Date() });
  await client.insert(dungeonRun).values({
    id: meta.runId,
    dungeonId,
    leaderId: members[0]!,
    content,
    state: meta.runState,
    status: "FIGHTING",
    version: meta.runVersion,
    battleId,
    expiresAt: new Date(meta.expiresAt),
    createdAt: new Date(),
  });
  return {
    meta,
    content,
    coop: { kind: "dungeon" as const, ...meta, battleId, waves },
  };
};
