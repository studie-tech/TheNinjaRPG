import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  mapAsset,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  sectorMap,
  userData,
} from "@/drizzle/schema";
import { overworldAiRouter } from "@/routers/overworldAi";
import { validateQuestStructures } from "@/server/utils/mapLocations";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { MoveToObjective } from "@/validators/objectives";
import { OverworldPlacementSchema } from "@/validators/overworldAi";
import { QuestReward } from "@/validators/rewardPackages";
import { insertQuests, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const data = OverworldPlacementSchema.parse({
  aiTemplateUserId: "npc",
  interactionType: "FRIENDLY",
  sector: 724,
  longitude: 0,
  latitude: 0,
});
const objective = MoveToObjective.parse({
  id: "tower",
  task: "move_to_location",
  overworldPlacementId: "placement",
  structureAssetId: "art",
});

describeWithDatabase("NPC placement structure bindings", () => {
  beforeEach(async () => {
    await resetTables(
      mapAsset,
      overworldAiPlacement,
      overworldAiPlacementQuest,
      quest,
      sectorMap,
      userData,
    );
    invalidatePublishedMapCache();
    await insertUsers([
      { userId: "staff", role: "CONTENT" },
      { userId: "npc", isAi: true },
    ]);
    const db = await getTestDatabase();
    await db.insert(mapAsset).values({
      id: "art",
      key: "tower",
      name: "Tower",
      imageUrl: "https://example.com/tower.png",
    });
    await db.insert(overworldAiPlacement).values({ id: "placement", ...data });
    await db.insert(sectorMap).values({
      id: "map",
      sector: 724,
      name: "Map",
      width: 1,
      height: 1,
      status: "PUBLISHED",
      normalizedJson: {
        formatVersion: 1,
        sector: 724,
        name: "Map",
        width: 1,
        height: 1,
        tiles: [
          {
            x: 0,
            y: 0,
            terrain: "ground",
            walkCost: 1,
            blocked: false,
            zone: "wilderness",
            battleBiome: "ground",
          },
        ],
        objects: [],
        anchors: [],
        exits: [],
        metadata: { importedAt: new Date().toISOString(), source: "tiled" },
      },
    });
    await insertQuests([
      {
        id: "bound",
        name: "Tower quest",
        content: {
          objectives: [objective],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });

  it.each([
    { locationType: "random" as const },
    { sectorType: "from_list" as const, sectorList: [724] },
    { sectorType: "random" as const },
  ])(
    "keeps structure-bound NPCs fixed when editing placement mode: %j",
    async (mode) => {
      const db = await getTestDatabase();
      expect(
        await validateQuestStructures(db, {
          publicLocations: false,
          content: { objectives: [objective] },
        }),
      ).toBeNull();
      const caller = await callerFor(overworldAiRouter, "staff");
      const result = await caller.upsertPlacement({
        id: "placement",
        data: OverworldPlacementSchema.parse({ ...data, ...mode }),
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("structure");
      expect(
        await db.query.overworldAiPlacement.findFirst({
          where: eq(overworldAiPlacement.id, "placement"),
        }),
      ).toMatchObject({
        sectorType: "specific",
        locationType: "specific",
        positionVersion: 0,
      });
    },
  );

  it("allows roaming when the bound objective has no structure art", async () => {
    const db = await getTestDatabase();
    await db
      .update(quest)
      .set({
        content: {
          objectives: [{ ...objective, structureAssetId: "" }],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })
      .where(eq(quest.id, "bound"));
    const caller = await callerFor(overworldAiRouter, "staff");
    expect(
      (
        await caller.upsertPlacement({
          id: "placement",
          data: { ...data, locationType: "random" },
        })
      ).success,
    ).toBe(true);
    expect(
      await db.query.overworldAiPlacement.findFirst({
        where: eq(overworldAiPlacement.id, "placement"),
      }),
    ).toMatchObject({ locationType: "random" });
  });

  it("ignores structures on another objective of the same bound quest", async () => {
    const db = await getTestDatabase();
    await db
      .update(quest)
      .set({
        content: {
          objectives: [
            { ...objective, structureAssetId: "" },
            { ...objective, id: "other", overworldPlacementId: "other-placement" },
          ],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })
      .where(eq(quest.id, "bound"));
    const caller = await callerFor(overworldAiRouter, "staff");
    expect(
      (
        await caller.upsertPlacement({
          id: "placement",
          data: { ...data, locationType: "random" },
        })
      ).success,
    ).toBe(true);
  });

  it("allows a structure-bound NPC to keep a fixed, stationary placement", async () => {
    const caller = await callerFor(overworldAiRouter, "staff");
    expect(
      (
        await caller.upsertPlacement({
          id: "placement",
          data: { ...data, wanderRadius: 0 },
        })
      ).success,
    ).toBe(true);
  });

  it("keeps a structure-bound NPC from roaming away from its building", async () => {
    const caller = await callerFor(overworldAiRouter, "staff");
    const result = await caller.upsertPlacement({
      id: "placement",
      data: { ...data, wanderRadius: 3 },
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Set the roaming radius to 0");
  });
});
