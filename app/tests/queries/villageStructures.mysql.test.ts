import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { mapAsset, village, villageStructure } from "@/drizzle/schema";
import { resolveWorldStructure } from "@/libs/rendering/worldStructures";
import mapStructures from "../../drizzle/data/mapStructures.json";
import snapshot from "../../drizzle/data/villageStructures.json";
import { seedPublishedBuildings } from "../../drizzle/seeds/structures";
import { prepareDevBuildings } from "../../scripts/dev-buildings";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("Published village buildings", () => {
  beforeEach(async () => {
    await resetTables(mapAsset, villageStructure, village);
  });

  it("updates art and adds production buildings while preserving local IDs, game state and QA structures", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values([
      {
        id: "local-horizon",
        name: "Horizon",
        kageId: "local-leader",
        sector: 301,
        tokens: 1234,
      },
      { id: "local-qa", name: "QA village", kageId: "qa-leader", sector: 302 },
    ]);
    await db.insert(villageStructure).values([
      {
        id: "local-bank",
        villageId: "local-horizon",
        name: "Bank",
        route: "/bank",
        image: "https://example.com/old-bank.png",
        level: 7,
        curSp: 42,
        maxSp: 321,
        bankInterestPerLvl: 9,
      },
      {
        id: "custom-building",
        villageId: "local-horizon",
        name: "Custom QA building",
        route: "/qa",
        image: "https://example.com/qa.png",
      },
      {
        id: "other-bank",
        villageId: "local-qa",
        name: "Bank",
        route: "/bank",
        image: "https://example.com/other.png",
      },
    ]);
    await db.insert(mapAsset).values([
      {
        id: "local-map-building",
        key: mapStructures[0]!.key,
        name: "Old fort",
        category: "structure",
        imageUrl: "https://example.com/old-fort.png",
        createdByUserId: "local-editor",
      },
      {
        id: "custom-map-asset",
        key: "custom.qa.asset",
        name: "QA prop",
        category: "prop",
        imageUrl: "https://example.com/custom.png",
      },
    ]);
    const result = await prepareDevBuildings({
      databaseUrl: "http://localhost:3002",
      client: db,
    });
    const buildings = await db.query.villageStructure.findMany({
      where: eq(villageStructure.villageId, "local-horizon"),
    });
    const published = snapshot.filter((entry) => entry.village === "Horizon");
    expect(result).toEqual({
      status: "ready",
      villages: 1,
      inserted: published.length - 1,
      updated: 1,
      mapAssetsInserted: mapStructures.length - 1,
      mapAssetsUpdated: 1,
    });
    expect(buildings).toHaveLength(published.length + 1);
    expect(buildings.find((entry) => entry.id === "local-bank")).toMatchObject({
      image: published.find((entry) => entry.route === "/bank")!.image,
      level: 7,
      curSp: 42,
      maxSp: 321,
      bankInterestPerLvl: 9,
    });
    for (const route of ["/towerDefense", "/chakraStorm", "/warehouse"])
      expect(buildings.find((entry) => entry.route === route)).toBeTruthy();
    expect(buildings.find((entry) => entry.id === "custom-building")?.image).toBe(
      "https://example.com/qa.png",
    );
    expect(
      (
        await db.query.villageStructure.findFirst({
          where: eq(villageStructure.id, "other-bank"),
        })
      )?.image,
    ).toBe("https://example.com/other.png");
    expect(
      (await db.query.village.findFirst({ where: eq(village.id, "local-horizon") }))
        ?.tokens,
    ).toBe(1234);
    expect(
      await db.query.mapAsset.findFirst({
        where: eq(mapAsset.id, "local-map-building"),
      }),
    ).toMatchObject({
      imageUrl: mapStructures[0]!.imageUrl,
      createdByUserId: "local-editor",
    });
    expect(
      await db.query.mapAsset.findFirst({ where: eq(mapAsset.id, "custom-map-asset") }),
    ).toMatchObject({ imageUrl: "https://example.com/custom.png" });
    const repeated = await recordQueries(() => seedPublishedBuildings(db));
    expect(repeated.result).toEqual({
      villages: 1,
      inserted: 0,
      updated: 0,
      mapAssetsInserted: 0,
      mapAssetsUpdated: 0,
    });
    expect(
      repeated.statements.filter((sql) => /^(insert|update|delete) /i.test(sql)),
    ).toHaveLength(0);
  });

  it("prepares every published settlement with resolvable art and raw material URLs", async () => {
    const db = await getTestDatabase();
    const names = [...new Set(snapshot.map((entry) => entry.village))];
    await db.insert(village).values(
      names.map((name, index) => ({
        id: `local-${index}`,
        name,
        sector: index + 1,
        kageId: "local-leader",
      })),
    );
    const prepared = await recordQueries(() => seedPublishedBuildings(db));
    expect(
      prepared.statements.filter((query) => /^(insert|update|delete) /i.test(query))
        .length,
    ).toBeLessThan(10);
    const saved = await db.query.villageStructure.findMany();
    expect(saved).toHaveLength(snapshot.length);
    for (const entry of saved) {
      if (!entry.worldArt) continue;
      expect(
        resolveWorldStructure(entry.image, entry.route, entry.worldArt),
      ).toBeTruthy();
      expect(entry.worldArt.sourceImage).toBe(entry.image);
      for (const url of [
        entry.worldArt.filepath,
        entry.worldArt.material,
        entry.worldArt.surfaces,
      ]) {
        expect(new URL(url).search).toBe("");
        expect(new URL(url).protocol).toBe("https:");
      }
    }
  });

  it("allows parallel preparations without duplicate buildings", async () => {
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "local-horizon", name: "Horizon", kageId: "local-leader" });
    await Promise.all([seedPublishedBuildings(db), seedPublishedBuildings(db)]);
    expect(await db.query.villageStructure.findMany()).toHaveLength(
      snapshot.filter((entry) => entry.village === "Horizon").length,
    );
  });
});
