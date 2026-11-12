import { describe, expect, it, vi } from "bun:test";
import { type SQL, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type UserData, village as villageTable } from "@/drizzle/schema";
import { travelRouter } from "@/server/api/routers/travel";
import { buildSectorWindowLayout } from "@/server/utils/sectorMap";
import {
  MoveToObjective,
  ObjectiveTracker,
  QuestTracker,
} from "@/validators/objectives";
import { deferred } from "../../../../setup/deferred";

const SECTOR = 500;
const STALE_SECTOR = 10;
const dialect = new MySqlDialect();
const queryParams = (options: { where: SQL }) =>
  dialect.sqlToQuery(options.where).params;
const placement = (sector: number, isAi: boolean | null = true) => ({
  id: `npc-${sector}`,
  aiTemplateUserId: "npc",
  interactionType: "FRIENDLY",
  sectorType: "specific",
  locationType: "specific",
  sector,
  longitude: 4,
  latitude: 5,
  positionVersion: 1,
  aiTemplate:
    isAi === null
      ? null
      : {
          userId: "npc",
          username: "Keeper",
          isAi,
          avatar: "/npc.png",
          avatarLight: "/npc.png",
          curHealth: 100,
          maxHealth: 100,
          level: 10,
          rank: "JONIN",
        },
});

const makeCaller = (
  options: {
    status?: UserData["status"];
    placements?: ReturnType<typeof placement>[];
    waitForUser?: boolean;
    activeHistory?: unknown[];
    questData?: UserData["questData"];
  } = {},
) => {
  const user = {
    userId: "viewer",
    status: options.status ?? "AWAKE",
    sector: SECTOR,
    villageId: null,
    rank: "JONIN",
    questData: options.questData ?? [],
    role: "USER",
  };
  const userGate = deferred<typeof user>();
  const findUser = vi.fn(() =>
    options.waitForUser ? userGate.promise : Promise.resolve(user),
  );
  const allSectorReadsStarted = deferred<void>();
  let readCount = 0;
  const read = <T>(result: (options: { where: SQL }) => T) =>
    vi.fn((query: { where: SQL }) => {
      if (++readCount === 7) allSectorReadsStarted.resolve();
      return Promise.resolve(result(query));
    });
  const users = read((query) => [
    {
      userId: `player-${queryParams(query)[0]}`,
      sector: queryParams(query)[0],
      status: "AWAKE",
      stealthActive: false,
      anbuSquad: null,
    },
  ]);
  const patrols = read(() => []);
  const village = read((query) => ({
    id: `village-${queryParams(query)[0]}`,
    sector: queryParams(query)[0],
    structures: [],
  }));
  const sector = read((query) => ({ sector: queryParams(query)[0], villageId: null }));
  const placements = read((query) =>
    (options.placements ?? []).filter((p) => queryParams(query).includes(p.sector)),
  );
  const wars = read(() => []);
  const battles = read(() => []);
  const history = vi.fn((query: { with?: { quest?: boolean } }) =>
    Promise.resolve(query.with?.quest ? (options.activeHistory ?? []) : []),
  );
  const caller = travelRouter.createCaller({
    userId: user.userId,
    drizzle: {
      query: {
        userData: {
          findFirst: findUser,
          findMany: (query: {
            where: SQL;
            columns?: { villageDutyStartedAt?: boolean };
          }) => (query.columns?.villageDutyStartedAt ? patrols(query) : users(query)),
        },
        village: { findFirst: village },
        sector: { findFirst: sector },
        war: { findMany: wars },
        overworldAiPlacement: { findMany: placements },
        questHistory: { findMany: history },
      },
      select: () => ({
        from: (table: unknown) => ({
          where: table === villageTable ? () => sql`(select 'home')` : battles,
        }),
      }),
    },
  } as never);
  return {
    caller,
    history,
    findUser,
    reads: { users, patrols, village, sector, placements, wars, battles },
    allSectorReadsStarted: allSectorReadsStarted.promise,
    releaseUser: () => userGate.resolve(user),
  };
};

describe("travel.getSectorData query scheduling", () => {
  it("starts all sector/global reads before the authoritative user lookup finishes", async () => {
    const test = makeCaller({ waitForUser: true });
    const pending = test.caller.getSectorData({ sector: SECTOR });
    try {
      await test.allSectorReadsStarted;
      expect(test.findUser).toHaveBeenCalledTimes(1);
      expect(test.history).not.toHaveBeenCalled();
      Object.values(test.reads).forEach((read) =>
        expect(read).toHaveBeenCalledTimes(1),
      );
    } finally {
      test.releaseUser();
    }
    await pending;
  });

  it.each(["AWAKE", "TRAVEL", "QUEUED"] as const)(
    "scouts while %s without reading quest history in an NPC-free window",
    async (status) => {
      const test = makeCaller({ status });
      const result = await test.caller.getSectorData({ sector: SECTOR });
      expect(result.users.map((u) => u.userId)).toEqual([
        `player-${SECTOR}`,
        ...(status === "AWAKE" ? ["viewer"] : []),
      ]);
      expect(result.questPlacements).toEqual([]);
      expect(result.overworldAis).toEqual([]);
      expect(test.history).not.toHaveBeenCalled();
      Object.values(test.reads).forEach((read) =>
        expect(read).toHaveBeenCalledTimes(1),
      );
    },
  );

  it.each([false, null])(
    "skips history when the placement's template is %s",
    async (isAi) => {
      const test = makeCaller({ placements: [placement(SECTOR, isAi)] });
      const result = await test.caller.getSectorData({ sector: SECTOR });
      expect(test.history).not.toHaveBeenCalled();
      expect(result.overworldAis).toEqual([]);
      expect(result.questPlacements).toEqual([]);
    },
  );

  it("loads both histories when an AI template can supply quest coordinates", async () => {
    const test = makeCaller({ placements: [placement(SECTOR)] });
    const result = await test.caller.getSectorData({ sector: SECTOR });
    expect(test.history).toHaveBeenCalledTimes(2);
    expect(test.history.mock.calls.filter(([query]) => query.with?.quest)).toHaveLength(
      1,
    );
    expect(result.overworldAis?.map((p) => p.npcPlacementId)).toEqual([
      `npc-${SECTOR}`,
    ]);
  });

  it("loads history for an AI in the neighboring window while withholding remote NPC actions", async () => {
    const neighbor = buildSectorWindowLayout(SECTOR).find(
      (p) => p.sector !== SECTOR,
    )!.sector;
    const test = makeCaller({ placements: [placement(neighbor)] });
    const result = await test.caller.getSectorData({ sector: SECTOR });
    expect(test.history).toHaveBeenCalledTimes(2);
    expect(result.overworldAis).toEqual([]);
  });

  it.each([false, true])(
    "preserves quest eligibility for a neighboring NPC (hidden=%s)",
    async (hidden) => {
      const neighbor = buildSectorWindowLayout(SECTOR).find(
        (p) => p.sector !== SECTOR,
      )!.sector;
      const npc = placement(neighbor);
      const objective = MoveToObjective.parse({
        id: "STARTING",
        task: "move_to_location",
        overworldPlacementId: npc.id,
        structureAssetId: "shrine",
      });
      const test = makeCaller({
        placements: [npc],
        questData: [
          QuestTracker.parse({
            id: "bound-quest",
            goals: [ObjectiveTracker.parse({ id: "STARTING" })],
          }),
        ],
        activeHistory: [
          {
            id: "history",
            questId: "bound-quest",
            questType: "mission",
            completed: 0,
            endAt: null,
            quest: {
              id: "bound-quest",
              questType: "mission",
              hidden,
              retryDelay: "none",
              consecutiveObjectives: true,
              content: { objectives: [objective], reward: {} },
            },
          },
        ],
      });
      const result = await test.caller.getSectorData({ sector: SECTOR });
      expect(result.questPlacements).toEqual(
        hidden
          ? []
          : [{ npcPlacementId: npc.id, sector: neighbor, longitude: 4, latitude: 5 }],
      );
      expect(result.overworldAis).toEqual([]);
    },
  );

  it("re-reads every sector-bound dataset after a crossing, keeping global reads once", async () => {
    const test = makeCaller({ placements: [placement(STALE_SECTOR)] });
    const result = await test.caller.getSectorData({ sector: STALE_SECTOR });
    expect(result.users.map((u) => u.userId)).toEqual([`player-${SECTOR}`, "viewer"]);
    expect(result.village?.id).toBe(`village-${SECTOR}`);
    expect(result.sectorData?.sector).toBe(SECTOR);
    expect(result.overworldAis).toEqual([]);
    expect(test.history).not.toHaveBeenCalled();
    for (const read of [
      test.reads.users,
      test.reads.patrols,
      test.reads.village,
      test.reads.sector,
      test.reads.placements,
    ]) {
      expect(read).toHaveBeenCalledTimes(2);
    }
    for (const read of [test.reads.wars, test.reads.battles])
      expect(read).toHaveBeenCalledTimes(1);
    expect(
      test.reads.sector.mock.calls.map(([query]) => queryParams(query)[0]),
    ).toEqual([STALE_SECTOR, SECTOR]);
  });

  it("uses authoritative placements to decide whether history is needed after a crossing", async () => {
    const test = makeCaller({ placements: [placement(SECTOR)] });
    const result = await test.caller.getSectorData({ sector: STALE_SECTOR });
    expect(test.history).toHaveBeenCalledTimes(2);
    expect(result.overworldAis?.map((p) => p.npcPlacementId)).toEqual([
      `npc-${SECTOR}`,
    ]);
  });

  it.each(["ASLEEP", "HOSPITALIZED", "BATTLE"] as const)(
    "discards speculative data while %s without reading history or retrying a stale sector",
    async (status) => {
      const test = makeCaller({
        status,
        placements: [placement(SECTOR), placement(STALE_SECTOR)],
      });
      expect(await test.caller.getSectorData({ sector: STALE_SECTOR })).toEqual({
        users: [],
        village: null,
        sectorData: null,
        warData: null,
        overworldAis: [],
        questPlacements: [],
      });
      expect(test.history).not.toHaveBeenCalled();
      expect(test.reads.sector).toHaveBeenCalledTimes(1);
    },
  );
});
