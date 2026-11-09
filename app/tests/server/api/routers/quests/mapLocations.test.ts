import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { QuestReward } from "@/validators/rewardPackages";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { mapAsset, quest } from "@/drizzle/schema";
import { questsRouter } from "@/routers/quests";
import {
  fetchPublicQuestLocations,
  invalidatePublicQuestLocations,
  isStructureAssetUsed,
  validateQuestStructures,
} from "@/server/utils/mapLocations";
import { MoveToObjective } from "@/validators/objectives";
import { insertQuests } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const objective = MoveToObjective.parse({
  id: "tower",
  task: "move_to_location",
  sector: 724,
  longitude: 3,
  latitude: 4,
  structureAssetId: "asset",
  locationName: "Tower",
  locationDescription: "An old tower.",
  description: "Secret mission",
});

describeWithDatabase("public quest map locations", () => {
  beforeEach(async () => {
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in quest map location tests",
    });
    await resetTables(quest, mapAsset);
    invalidatePublicQuestLocations();
    await insertQuests([
      {
        id: "public",
        publicLocations: true,
        content: {
          objectives: [objective],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
      {
        id: "private",
        publicLocations: false,
        content: {
          objectives: [objective],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
      {
        id: "hidden",
        publicLocations: true,
        hidden: true,
        content: {
          objectives: [objective],
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists only public neutral presentation without fetching player history", async () => {
    const caller = await callerFor(questsRouter, "visitor-with-no-history");
    const locations = await caller.getPublicLocations();
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      questId: "public",
      description: "An old tower.",
    });
    expect(JSON.stringify(locations)).not.toContain("Secret");
    expect(JSON.stringify(locations)).not.toContain("reward");
  });

  it("invalidates a cached public projection when publication changes", async () => {
    const db = await getTestDatabase();
    expect(await fetchPublicQuestLocations(db)).toHaveLength(1);
    await db
      .update(quest)
      .set({ publicLocations: false })
      .where(eq(quest.id, "public"));
    invalidatePublicQuestLocations();
    expect(await fetchPublicQuestLocations(db)).toEqual([]);
  });

  it("checks asset references and prevents removing an in-use sprite", async () => {
    const db = await getTestDatabase();
    expect(await isStructureAssetUsed(db, "asset")).toBe(true);
    expect(
      await validateQuestStructures(db, {
        publicLocations: false,
        content: { objectives: [objective] },
      }),
    ).toContain("no longer exists");
    await db.insert(mapAsset).values({
      id: "asset",
      key: "tower",
      name: "Tower",
      imageUrl: "https://example.com/tower.png",
    });
    expect(
      await validateQuestStructures(db, {
        publicLocations: false,
        content: { objectives: [objective] },
      }),
    ).toBeNull();
  });
});
