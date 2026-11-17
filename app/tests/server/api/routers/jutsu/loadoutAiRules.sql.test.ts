import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { aiProfile, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "rules-switcher";

const pointer = async (id = userId) =>
  await (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, id),
    columns: { aiProfileId: true, jutsuLoadout: true },
  });

describeWithDatabase("jutsu loadouts carry their AI rules", () => {
  beforeEach(async () => {
    await resetTables(aiProfile, jutsuLoadout, userJutsu, userData);
    await insertUsers([
      {
        userId,
        username: "RulesSwitcher",
        rank: "JONIN",
        level: 50,
        status: "AWAKE",
        jutsuLoadout: "main",
      },
    ]);
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values([
      { id: "main", userId, jutsuIds: [] },
      { id: "pvp", userId, jutsuIds: [], customAi: true },
    ]);
    await db.insert(aiProfile).values([
      { id: "rules-pvp", userId, jutsuLoadoutId: "pvp", rules: [] },
      { id: "rules-main", userId, jutsuLoadoutId: "main", rules: [] },
    ]);
  });

  it("fights with the selected loadout's own rules, or the Default ones", async () => {
    const api = await callerFor(jutsuRouter, userId);
    const toPvp = await api.selectJutsuLoadout({ id: "pvp" });
    expect(toPvp.success).toBe(true);
    expect(await pointer()).toEqual({ jutsuLoadout: "pvp", aiProfileId: "rules-pvp" });
    expect(toPvp.userPatch).toMatchObject({
      jutsuLoadout: "pvp",
      aiProfileId: "rules-pvp",
    });
    // The main loadout keeps its own rules row but fights with the Default rules.
    const toMain = await api.selectJutsuLoadout({ id: "main" });
    expect(await pointer()).toEqual({ jutsuLoadout: "main", aiProfileId: null });
    expect(toMain.userPatch).toMatchObject({ jutsuLoadout: "main", aiProfileId: null });
  });

  it("patches the profile with the rules the selection stored when they switch mid-request", async () => {
    const db = await getTestDatabase();
    // Another tab switches the loadout to the Default rules after this request read it.
    const raced = beforeStatements(
      db,
      jutsuLoadout,
      [
        () =>
          db
            .update(jutsuLoadout)
            .set({ customAi: false })
            .where(eq(jutsuLoadout.id, "pvp")),
      ],
      { operations: ["execute"] },
    );
    const result = await callerForDatabase(
      jutsuRouter,
      userId,
      raced,
    ).selectJutsuLoadout({ id: "pvp" });
    expect(await pointer()).toEqual({ jutsuLoadout: "pvp", aiProfileId: null });
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({ jutsuLoadout: "pvp", aiProfileId: null });
  });

  it("keeps the rules a first loadout already owns when it becomes the active one", async () => {
    await insertUsers([
      { userId: "unpointed", username: "Unpointed", aiProfileId: "rules-unpointed" },
    ]);
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values([
      {
        id: "u1",
        userId: "unpointed",
        jutsuIds: [],
        customAi: true,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "u2",
        userId: "unpointed",
        jutsuIds: [],
        customAi: true,
        createdAt: new Date("2026-01-02"),
      },
    ]);
    await db.insert(aiProfile).values([
      { id: "rules-unpointed", userId: "unpointed", jutsuLoadoutId: "u1", rules: [] },
      {
        id: "rules-unpointed-u2",
        userId: "unpointed",
        jutsuLoadoutId: "u2",
        rules: [],
      },
    ]);
    await (await callerFor(jutsuRouter, "unpointed")).getLoadouts();
    expect(await pointer("unpointed")).toEqual({
      jutsuLoadout: "u1",
      aiProfileId: "rules-unpointed",
    });
    const first = await db.query.jutsuLoadout.findFirst({
      where: eq(jutsuLoadout.id, "u1"),
    });
    expect(first?.customAi).toBe(true);
  });

  it("gives a player's first loadout the rules they wrote before having one", async () => {
    await insertUsers([
      { userId: "legacy", username: "Legacy", aiProfileId: "rules-legacy" },
      { userId: "plain", username: "Plain" },
    ]);
    const db = await getTestDatabase();
    await db.insert(aiProfile).values([
      { id: "rules-legacy", userId: "legacy", rules: [] },
      { id: "rules-plain", userId: "plain", rules: [] },
    ]);
    const legacy = await (await callerFor(jutsuRouter, "legacy")).getLoadouts();
    const first = legacy[0]?.id as string;
    // The answer already shows the rules the first loadout fights with.
    expect(legacy[0]).toMatchObject({
      customAi: true,
      aiProfile: { id: "rules-legacy" },
    });
    expect(await pointer("legacy")).toEqual({
      jutsuLoadout: first,
      aiProfileId: "rules-legacy",
    });
    const legacyRows = await db.query.jutsuLoadout.findMany({
      where: eq(jutsuLoadout.userId, "legacy"),
      columns: { id: true, customAi: true },
      with: { aiProfile: { columns: { id: true } } },
    });
    expect(legacyRows.find((row) => row.id === first)).toEqual({
      id: first,
      customAi: true,
      aiProfile: { id: "rules-legacy" },
    });
    // A player on the Default rules keeps them, with their own rules kept for later.
    const plain = await (await callerFor(jutsuRouter, "plain")).getLoadouts();
    const plainFirst = plain[0]?.id as string;
    expect(await pointer("plain")).toEqual({
      jutsuLoadout: plainFirst,
      aiProfileId: null,
    });
    const plainRow = await db.query.aiProfile.findFirst({
      where: eq(aiProfile.id, "rules-plain"),
    });
    expect(plainRow?.jutsuLoadoutId).toBe(plainFirst);
  });
});
