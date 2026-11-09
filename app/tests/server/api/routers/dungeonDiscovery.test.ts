import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  dungeon,
  dungeonMember,
  dungeonRun,
  questHistory,
  userData,
  userItem,
} from "@/drizzle/schema";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import { dungeonContent } from "../../../setup/dungeon";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("Dungeon discovery visibility", () => {
  beforeEach(async () => {
    await resetTables(
      dungeon,
      dungeonMember,
      dungeonRun,
      questHistory,
      userData,
      userItem,
    );
    await insertUsers([{ userId: "explorer", sector: 1, level: 1 }]);
  });

  it("keeps published entrance visibility independent of personal admission", async () => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    content.requirements.requiredLevel = 2;
    await db.insert(dungeon).values({ id: "entrance", content, updatedAt: new Date() });
    const caller = await callerFor(dungeonRouter, "explorer");
    expect(await caller.getAvailable({ sector: 1 })).toMatchObject([
      { id: "entrance", admission: { error: "Requires level 2." } },
    ]);
    await db.update(userData).set({ level: 2 }).where(eq(userData.userId, "explorer"));
    expect(await caller.getAvailable({ sector: 1 })).toMatchObject([
      { id: "entrance", admission: { error: null } },
    ]);
  });

  it("withholds hidden, expired and other-sector definitions and checks the player's current sector", async () => {
    const db = await getTestDatabase();
    await db.insert(dungeon).values(
      [
        { id: "visible", content: dungeonContent() },
        { id: "hidden", content: { ...dungeonContent(), hidden: true } },
        { id: "expired", content: { ...dungeonContent(), expiresAt: new Date(0) } },
        { id: "elsewhere", content: { ...dungeonContent(), sector: 2 } },
      ].map((definition) => ({ ...definition, updatedAt: new Date() })),
    );
    const caller = await callerFor(dungeonRouter, "explorer");
    expect((await caller.getAvailable({ sector: 1 })).map(({ id }) => id)).toEqual([
      "visible",
    ]);
    expect(await caller.getAvailable({ sector: 2 })).toEqual([]);
    await db.update(userData).set({ sector: 2 }).where(eq(userData.userId, "explorer"));
    expect(await caller.getAvailable({ sector: 1 })).toEqual([]);
    expect((await caller.getAvailable({ sector: 2 })).map(({ id }) => id)).toEqual([
      "elsewhere",
    ]);
  });

  it("lists published dungeons across sectors without exposing encounter definitions", async () => {
    const db = await getTestDatabase();
    await db.insert(dungeon).values(
      [
        { id: "ongoing", content: dungeonContent() },
        {
          id: "timed",
          content: {
            ...dungeonContent(),
            sector: 2,
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
        { id: "hidden", content: { ...dungeonContent(), hidden: true } },
        { id: "expired", content: { ...dungeonContent(), expiresAt: new Date(0) } },
      ].map((definition) => ({ ...definition, updatedAt: new Date() })),
    );
    const caller = await callerFor(dungeonRouter, "explorer");
    const catalogue = await caller.getCatalogue();
    expect(catalogue.map(({ id }) => id)).toEqual(["timed", "ongoing"]);
    expect(catalogue[0]).toMatchObject({ sector: 2, rewards: { money: 100 } });
    expect(catalogue[0]).not.toHaveProperty("content");
    expect(catalogue[0]).not.toHaveProperty("tiers");
  });

  it("ranks complete squads by elapsed time or finish order and excludes unmeasured runs", async () => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    await db.insert(dungeon).values({ id: "ranked", content, updatedAt: new Date() });
    const base = {
      dungeonId: "ranked",
      leaderId: "explorer",
      content,
      status: "COMPLETED" as const,
      createdAt: new Date(),
    };
    const state = {
      memberIds: ["explorer", "deleted"],
      invitedIds: [],
      readyIds: [],
      floor: 5,
      clearedFloors: [0, 1, 2, 3, 4],
      message: "",
    };
    await db.insert(dungeonRun).values([
      {
        ...base,
        id: "first",
        state: { ...state, entryPaidAt: 1000, completedAt: 5000 },
      },
      {
        ...base,
        id: "fastest",
        state: { ...state, entryPaidAt: 5000, completedAt: 6000 },
      },
      { ...base, id: "legacy", state },
      {
        ...base,
        id: "unfinished",
        status: "BETWEEN",
        state: { ...state, entryPaidAt: 1000, completedAt: 2000 },
      },
    ]);
    const caller = await callerFor(dungeonRouter, "explorer");
    const fastest = await caller.getRankings({
      dungeonId: "ranked",
      mode: "fastest",
      page: 0,
    });
    expect(fastest.entries.map(({ id }) => id)).toEqual(["fastest", "first"]);
    expect(fastest.entries[0]).toMatchObject({
      rank: 1,
      durationMs: 1000,
      players: [{ id: "explorer" }, { id: "deleted", name: "Deleted player" }],
    });
    const completed = await caller.getRankings({
      dungeonId: "ranked",
      mode: "completed",
      page: 0,
    });
    expect(completed.entries.map(({ id }) => id)).toEqual(["first", "fastest"]);
    await db
      .update(dungeon)
      .set({ content: { ...content, hidden: true } })
      .where(eq(dungeon.id, "ranked"));
    expect(
      await caller.getRankings({ dungeonId: "ranked", mode: "fastest", page: 0 }),
    ).toEqual({ entries: [], hasMore: false });
    expect(await caller.getHallOfFameDungeons()).toEqual([]);
  });
});
