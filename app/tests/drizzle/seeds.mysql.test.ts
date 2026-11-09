import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  PET_SANCTUARY_IMAGE,
  PET_SANCTUARY_LATITUDE,
  PET_SANCTUARY_LONGITUDE,
  PET_SANCTUARY_NAME,
} from "@/drizzle/constants";
import {
  bloodline,
  conversation,
  forumBoard,
  forumSection,
  guideArticle,
  item,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { SYSTEM_GUIDE_ARTICLES } from "@/libs/guide/articles";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import { seedForum } from "../../drizzle/seeds/forum";
import { seedGuides } from "../../drizzle/seeds/guide";
import { seedVillages } from "../../drizzle/seeds/village";
import { insertItems } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const insertBloodline = async (name: string, image: string) => {
  const database = await getTestDatabase();
  await database.insert(bloodline).values({
    id: `bloodline-${name}`,
    name,
    image,
    description: "test",
    effects: [],
    regenIncrease: 0,
    village: "All",
    rank: "B",
  } as never);
};

const guideBySlug = async (slug: string) => {
  const database = await getTestDatabase();
  return database.query.guideArticle.findFirst({ where: eq(guideArticle.slug, slug) });
};

describeWithDatabase("content seeds", () => {
  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await resetTables(
      bloodline,
      conversation,
      forumBoard,
      forumSection,
      guideArticle,
      item,
      village,
      villageStructure,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("stores every system guide with its hosted cover", async () => {
    await seedGuides(await getTestDatabase());

    const database = await getTestDatabase();
    const rows = await database.select().from(guideArticle);
    expect(rows.map((row) => row.slug).sort()).toEqual(
      SYSTEM_GUIDE_ARTICLES.map((article) => article.slug).sort(),
    );
    for (const row of rows) {
      expect(row.image).toBe(`https://ui0arpl8sm.ufs.sh/f/guide-${row.slug}-v3.webp`);
    }
  });

  it("gives generated guides their entity's image and relation", async () => {
    await insertBloodline("Seed Crystal Line", "/seed-crystal.webp");
    await insertItems([
      {
        id: "seed-herb",
        name: "Seed Moonleaf",
        image: "/moonleaf.webp",
        isFarmSeed: true,
      },
    ]);

    await seedGuides(await getTestDatabase());

    expect(await guideBySlug("seed-crystal-line")).toEqual(
      expect.objectContaining({
        image: "/seed-crystal.webp",
        relatedBloodlineId: "bloodline-Seed Crystal Line",
        relatedItemId: null,
        published: true,
      }),
    );
    expect(await guideBySlug("seed-moonleaf")).toEqual(
      expect.objectContaining({
        image: "/moonleaf.webp",
        relatedBloodlineId: null,
        relatedItemId: "seed-herb",
        published: false,
      }),
    );
  });

  it("keeps existing guides, system slugs and reserved slugs out of generated inserts", async () => {
    const database = await getTestDatabase();
    await insertBloodline("Combat", "/combat-line.webp");
    await insertBloodline("Edit", "/edit-line.webp");
    await insertBloodline("Seed Crystal Line", "/seed-crystal.webp");
    await database.insert(guideArticle).values({
      id: "staff-guide",
      slug: "seed-crystal-line",
      title: "Written by staff",
      category: "bloodlines",
      content: "<p>Staff copy</p>",
    });

    await seedGuides(database);
    await seedGuides(database);

    expect((await guideBySlug("combat"))?.relatedBloodlineId).toBeNull();
    expect(await guideBySlug("edit")).toBeUndefined();
    expect(await guideBySlug("seed-crystal-line")).toEqual(
      expect.objectContaining({
        id: "staff-guide",
        title: "Written by staff",
        image: null,
      }),
    );
    const rows = await database.select({ slug: guideArticle.slug }).from(guideArticle);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(rows.length);
  });

  it("creates the built-in forum hierarchy once", async () => {
    const database = await getTestDatabase();
    await seedForum(database);
    await seedForum(database);

    const sections = await database.select().from(forumSection);
    const boards = await database.select().from(forumBoard);
    expect(sections.map((section) => section.name).sort()).toEqual([
      "Main Broadcast",
      "Text-Based RPG",
      "The Chat Lounge",
    ]);
    expect(boards).toHaveLength(9);
    for (const section of sections) {
      expect(section.policy).toEqual({});
      expect(boards.some((board) => board.sectionId === section.id)).toBe(true);
    }
    for (const board of boards) {
      expect(board.policy).toEqual(board.name === "News" ? { create: "STAFF" } : {});
    }
  });

  it("restores only what missing boards need and leaves staff-managed boards alone", async () => {
    const database = await getTestDatabase();
    await seedForum(database);
    // Staff moved the lounge's only board and retired that section.
    await database
      .update(forumBoard)
      .set({ summary: "Staff summary", sectionId: "staff-section" })
      .where(eq(forumBoard.name, "The Chat Threads"));
    await database.delete(forumSection).where(eq(forumSection.name, "The Chat Lounge"));
    await database.delete(forumBoard).where(eq(forumBoard.name, "News"));
    await database.delete(forumSection).where(eq(forumSection.name, "Main Broadcast"));

    await seedForum(database);

    const sections = await database.select().from(forumSection);
    expect(sections.map((section) => section.name).sort()).toEqual([
      "Main Broadcast",
      "Text-Based RPG",
    ]);
    const lounge = await database.query.forumBoard.findFirst({
      where: eq(forumBoard.name, "The Chat Threads"),
    });
    expect(lounge).toEqual(
      expect.objectContaining({ summary: "Staff summary", sectionId: "staff-section" }),
    );
    const news = await database.query.forumBoard.findFirst({
      where: eq(forumBoard.name, "News"),
    });
    expect(news?.policy).toEqual({ create: "STAFF" });
    expect(sections.map((section) => section.id)).toContain(news?.sectionId ?? "");
  });

  it("rebuilds villages on their landmark sectors with one sanctuary across reseeds", async () => {
    const database = await getTestDatabase();
    await seedVillages(database);
    await seedVillages(database);

    const villages = await database.select().from(village);
    for (const landmark of WORLD_LANDMARKS) {
      const rows = villages.filter((row) => row.name === landmark.name);
      for (const row of rows) expect(row.sector).toBe(landmark.sector);
    }
    const wakeIsland = villages.find((row) => row.name === "Wake Island");
    const sanctuaries = await database
      .select()
      .from(villageStructure)
      .where(eq(villageStructure.route, "/pets"));
    expect(sanctuaries).toHaveLength(1);
    expect(sanctuaries[0]).toEqual(
      expect.objectContaining({
        id: "wake-bondkeeper-sanctuary",
        name: PET_SANCTUARY_NAME,
        image: PET_SANCTUARY_IMAGE,
        villageId: wakeIsland?.id,
        longitude: PET_SANCTUARY_LONGITUDE,
        latitude: PET_SANCTUARY_LATITUDE,
        hasPage: 1,
        allyAccess: 1,
        maxLevel: 1,
      }),
    );
  });
});
