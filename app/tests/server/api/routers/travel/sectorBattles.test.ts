import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  battle,
  overworldAiPlacement,
  quest,
  questHistory,
  sector,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import { getQuestMapLocations } from "@/libs/mapLocations";
import { getNewTrackers } from "@/libs/quest";
import { SECTOR_BATTLE_STALE_SECONDS } from "@/libs/travel";
import { travelRouter } from "@/server/api/routers/travel";
import { buildSectorWindowLayout } from "@/server/utils/sectorMap";
import {
  DeliverItem,
  DialogObjective,
  InstantWinLoseObjective,
  MoveToObjective,
  ObjectiveTracker,
  QuestTracker,
} from "@/validators/objectives";
import { QuestReward } from "@/validators/rewardPackages";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const SECTOR = 42;
const VIEWER = "sector-viewer";

const insertBattle = async (id: string, updatedAt: Date) => {
  const database = await getTestDatabase();
  await database.insert(battle).values({
    id,
    updatedAt,
    background: "ground",
    battleType: "COMBAT",
    usersState: [],
    usersEffects: [],
    groundEffects: [],
    extraState: {} as never,
  });
};

describeWithDatabase("travel.getSectorData battle markers", () => {
  beforeEach(async () => {
    await resetTables(
      userData,
      battle,
      village,
      sector,
      war,
      overworldAiPlacement,
      questHistory,
      quest,
    );
    await insertUsers([
      { userId: VIEWER, username: "Viewer", status: "AWAKE", sector: SECTOR },
      // Fight still being played
      {
        userId: "live-fighter",
        username: "Live",
        status: "BATTLE",
        battleId: "live",
        sector: SECTOR,
      },
      // Knocked out and never returned to settle: battle row frozen
      {
        userId: "abandoned-fighter",
        username: "Abandoned",
        status: "BATTLE",
        battleId: "abandoned",
        sector: SECTOR,
      },
      // Battle row already deleted, status not yet cleaned up by the cron
      {
        userId: "orphaned-fighter",
        username: "Orphaned",
        status: "BATTLE",
        battleId: "deleted",
        sector: SECTOR,
      },
    ]);
    await insertBattle("live", new Date());
    await insertBattle(
      "abandoned",
      new Date(Date.now() - (SECTOR_BATTLE_STALE_SECONDS + 60) * 1000),
    );
  });

  it("only returns fighters whose battle exists and is still being played", async () => {
    const api = await callerFor(travelRouter, VIEWER);
    const result = await api.getSectorData({ sector: SECTOR });
    expect(result.users.map((u) => u.userId).sort()).toEqual(
      ["live-fighter", VIEWER].sort(),
    );
  });
});

describeWithDatabase("travel.getSectorData quest landmark placements", () => {
  const neighbor = buildSectorWindowLayout(SECTOR).find(
    (entry) => entry.dx === 1 && entry.dy === -1,
  )!.sector;
  const objective = MoveToObjective.parse({
    id: "STARTING",
    task: "move_to_location",
    overworldPlacementId: "remote",
    structureAssetId: "tower",
    nextObjectiveId: "detail",
  });
  const detail = DialogObjective.parse({
    id: "detail",
    task: "dialog",
    structureAssetId: "shrine",
    nextObjectiveId: [{ text: "Finish", nextObjectiveId: "end" }],
  });
  const tracker = QuestTracker.parse({
    id: "bound-quest",
    goals: [
      ObjectiveTracker.parse({ id: "STARTING" }),
      ObjectiveTracker.parse({ id: "detail" }),
    ],
  });
  const readLandmarks = async (
    placements: Parameters<typeof getQuestMapLocations>[2],
  ) => {
    const db = await getTestDatabase();
    const [viewer, userQuests] = await Promise.all([
      db.query.userData.findFirst({ where: eq(userData.userId, VIEWER) }),
      db.query.questHistory.findMany({
        where: eq(questHistory.userId, VIEWER),
        with: { quest: true },
      }),
    ]);
    if (!viewer) throw new Error("Missing sector viewer");
    return getQuestMapLocations({ ...viewer, userQuests }, [], placements);
  };

  beforeEach(async () => {
    await resetTables(
      userData,
      battle,
      village,
      sector,
      war,
      overworldAiPlacement,
      questHistory,
      quest,
    );
    await insertUsers([
      { userId: VIEWER, status: "AWAKE", sector: SECTOR, questData: [tracker] },
      { userId: "npc", username: "Keeper", isAi: true },
    ]);
    await insertQuests([
      {
        id: "bound-quest",
        content: {
          objectives: [
            objective,
            detail,
            InstantWinLoseObjective.parse({ id: "end", task: "win_quest" }),
          ],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertQuestHistory([{ questId: "bound-quest", userId: VIEWER }]);
    await (await getTestDatabase()).insert(overworldAiPlacement).values([
      {
        id: "local",
        aiTemplateUserId: "npc",
        interactionType: "FRIENDLY",
        sectorList: [],
        sector: SECTOR,
        longitude: 1,
        latitude: 2,
      },
      {
        id: "remote",
        aiTemplateUserId: "npc",
        interactionType: "FRIENDLY",
        sectorList: [],
        sector: neighbor,
        longitude: 4,
        latitude: 5,
      },
      {
        id: "unrelated",
        aiTemplateUserId: "npc",
        interactionType: "FRIENDLY",
        sectorList: [],
        sector: neighbor,
        longitude: 8,
        latitude: 9,
      },
    ]);
  });

  it("returns only coordinate data for an active neighboring landmark while keeping NPC interactions local", async () => {
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
      sector: SECTOR,
    });
    expect(result.questPlacements).toEqual([
      { npcPlacementId: "remote", sector: neighbor, longitude: 4, latitude: 5 },
    ]);
    expect(result.overworldAis?.map((npc) => npc.npcPlacementId)).toEqual(["local"]);
    expect(await readLandmarks(result.questPlacements)).toMatchObject([
      { objectiveId: "STARTING", sector: neighbor, longitude: 4, latitude: 5 },
    ]);
  });

  it.each(["USER", "CONTENT"] as const)(
    "preserves concealed neighboring targets for %s",
    async (role) => {
      const db = await getTestDatabase();
      await db.update(userData).set({ role }).where(eq(userData.userId, VIEWER));
      await db
        .update(quest)
        .set({
          content: {
            objectives: [{ ...objective, hideLocation: true }, detail],
            reward: QuestReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        })
        .where(eq(quest.id, "bound-quest"));
      const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
        sector: SECTOR,
      });
      expect(result.questPlacements).toHaveLength(role === "USER" ? 0 : 1);
      expect(result.overworldAis?.map((npc) => npc.npcPlacementId)).toEqual(["local"]);
    },
  );

  it("retains a completed NPC predecessor needed by an unbound implicit dialog", async () => {
    const completedTracker = structuredClone(tracker);
    Object.assign(completedTracker.goals[0]!, {
      done: true,
      selectedNextObjectiveId: "detail",
    });
    await (await getTestDatabase())
      .update(userData)
      .set({ questData: [completedTracker] })
      .where(eq(userData.userId, VIEWER));
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
      sector: SECTOR,
    });
    expect(result.questPlacements).toEqual([
      { npcPlacementId: "remote", sector: neighbor, longitude: 4, latitude: 5 },
    ]);
    expect(await readLandmarks(result.questPlacements)).toMatchObject([
      {
        objectiveId: "detail",
        assetId: "shrine",
        sector: neighbor,
        longitude: 4,
        latitude: 5,
      },
    ]);
  });

  it("retains remote NPC coordinates after a bound delivery advances into an implicit dialog", async () => {
    const db = await getTestDatabase();
    const delivery = DeliverItem.parse({
      ...objective,
      task: "deliver_item",
      deliverItemIds: ["scroll"],
    });
    await db
      .update(quest)
      .set({
        content: {
          objectives: [
            delivery,
            detail,
            InstantWinLoseObjective.parse({ id: "end", task: "win_quest" }),
          ],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })
      .where(eq(quest.id, "bound-quest"));
    const [viewer, userQuests] = await Promise.all([
      db.query.userData.findFirst({ where: eq(userData.userId, VIEWER) }),
      db.query.questHistory.findMany({
        where: eq(questHistory.userId, VIEWER),
        with: { quest: true },
      }),
    ]);
    const actor = {
      ...viewer,
      userQuests,
      completedQuests: [],
      useritems: [
        {
          itemId: "scroll",
          quantity: 1,
          storedAtHome: false,
          isInAuction: false,
          craftingFinishedAt: null,
        },
      ],
    } as unknown as Parameters<typeof getNewTrackers>[0];
    const placementStatus = new Map([["remote", true]]);
    actor.questData = getNewTrackers(
      actor,
      [{ task: "any" }],
      undefined,
      placementStatus,
      new Set(),
    ).trackers;
    Object.assign(actor, { sector: neighbor, longitude: 4, latitude: 5 });
    actor.questData = getNewTrackers(
      actor,
      [{ task: "any" }],
      undefined,
      placementStatus,
      new Set(["remote"]),
    ).trackers;
    expect(actor.questData[0]?.goals[0]?.done).toBe(true);
    await db
      .update(userData)
      .set({ questData: actor.questData })
      .where(eq(userData.userId, VIEWER));
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
      sector: SECTOR,
    });
    expect(result.questPlacements).toEqual([
      { npcPlacementId: "remote", sector: neighbor, longitude: 4, latitude: 5 },
    ]);
    expect(result.overworldAis?.map((npc) => npc.npcPlacementId)).toEqual(["local"]);
    expect(await readLandmarks(result.questPlacements)).toMatchObject([
      {
        objectiveId: "detail",
        assetId: "shrine",
        sector: neighbor,
        longitude: 4,
        latitude: 5,
      },
    ]);
  });

  it.each([
    "completed",
    "abandoned",
    "ineligible",
    "outside-window",
    "roaming",
    "inactive",
  ])("withholds %s remote targets", async (state) => {
    const db = await getTestDatabase();
    if (state === "completed")
      await db
        .update(questHistory)
        .set({ completed: 1 })
        .where(eq(questHistory.userId, VIEWER));
    if (state === "abandoned")
      await db
        .update(questHistory)
        .set({ endAt: new Date() })
        .where(eq(questHistory.userId, VIEWER));
    if (state === "ineligible")
      await db.update(quest).set({ hidden: true }).where(eq(quest.id, "bound-quest"));
    if (state === "outside-window")
      await db
        .update(overworldAiPlacement)
        .set({ sector: 724 })
        .where(eq(overworldAiPlacement.id, "remote"));
    if (state === "roaming")
      await db
        .update(overworldAiPlacement)
        .set({ locationType: "random" })
        .where(eq(overworldAiPlacement.id, "remote"));
    if (state === "inactive")
      await db
        .update(overworldAiPlacement)
        .set({ isActive: false })
        .where(eq(overworldAiPlacement.id, "remote"));
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
      sector: SECTOR,
    });
    expect(result.questPlacements).toEqual([]);
    expect(result.overworldAis?.map((npc) => npc.npcPlacementId)).toEqual(["local"]);
  });
});
