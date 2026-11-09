import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { jutsu, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import { fetchUserJutsus, jutsuRouter } from "@/server/api/routers/jutsu";
import { DamageTag } from "@/validators/combat";
import type { JutsuFilteringSchema } from "@/validators/jutsu";
import { insertUsers, insertJutsus } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER = "filtered-loadout-player";
const pve = ["pve-nin", "pve-tai"];
const pvp = ["pvp-nin", "pvp-tai"];

describeWithDatabase("owned jutsu filters and equipped loadouts", () => {
  beforeEach(async () => {
    await resetTables(jutsuLoadout, userJutsu, jutsu, userData);
    await insertUsers([
      { userId: USER, username: USER, rank: "JONIN", level: 100, isOutlaw: true },
      { userId: "other-player", username: "other-player" },
    ]);
    const db = await getTestDatabase();
    await insertJutsus(
      [...pve, ...pvp, "ai-only"].map((id) => ({
        id,
        requiredRank: "GENIN" as const,
        jutsuType: id === "ai-only" ? ("AI" as const) : ("NORMAL" as const),
        effects: [
          DamageTag.parse({
            statTypes: [id.endsWith("nin") ? "Ninjutsu" : "Taijutsu"],
          }),
        ],
      })),
    );
    await db.insert(userJutsu).values([
      ...[...pve, ...pvp, "ai-only"].map((jutsuId) => ({
        id: `owned-${jutsuId}`,
        userId: USER,
        jutsuId,
        level: 10,
        equipped: pve.includes(jutsuId) || jutsuId === "ai-only",
      })),
      {
        id: "foreign-jutsu",
        userId: "other-player",
        jutsuId: "pvp-tai",
        equipped: true,
      },
    ]);
    await db.insert(jutsuLoadout).values([
      { id: "pve", userId: USER, name: "PvE", jutsuIds: pve, createdAt: new Date(0) },
      { id: "pvp", userId: USER, name: "PvP", jutsuIds: pvp, createdAt: new Date(1) },
    ]);
    await db
      .update(userData)
      .set({ jutsuLoadout: "pve" })
      .where(eq(userData.userId, USER));
  });

  it("shows the full equipped set after switching either loadout under an active stat filter", async () => {
    const caller = await callerFor(jutsuRouter, USER);
    for (const [id, expected] of [
      ["pvp", pvp],
      ["pve", pve],
    ] as const) {
      expect((await caller.selectJutsuLoadout({ id })).success).toBe(true);
      const visible = await caller.getUserJutsus({
        stat: ["Ninjutsu"],
        includeEquipped: true,
      });
      expect(
        visible
          .filter((row) => row.equipped)
          .map((row) => row.jutsuId)
          .sort(),
      ).toEqual(expected);
      expect(visible.filter((row) => !row.equipped).map((row) => row.jutsuId)).toEqual([
        id === "pve" ? "pvp-nin" : "pve-nin",
      ]);
    }
  });

  it("keeps unequipped inventory when no filters are active", async () => {
    const rows = await (await callerFor(jutsuRouter, USER)).getUserJutsus({
      includeEquipped: true,
    });
    expect(rows.map((row) => row.jutsuId).sort()).toEqual([...pve, ...pvp].sort());
    expect(rows.every((row) => row.userId === USER)).toBe(true);
  });

  it.each([
    { name: "does-not-match" },
    { excludedStats: ["Ninjutsu", "Taijutsu"] },
    { effect: ["heal"] },
  ] as JutsuFilteringSchema[])(
    "keeps equipped slots visible when filters exclude every jutsu: %j",
    async (filter) => {
      const rows = await (await callerFor(jutsuRouter, USER)).getUserJutsus({
        ...filter,
        includeEquipped: true,
      });
      expect(rows.map((row) => row.jutsuId).sort()).toEqual(pve);
      expect(
        rows.every(
          (row) => row.equipped && row.userId === USER && row.jutsu.jutsuType !== "AI",
        ),
      ).toBe(true);
    },
  );

  it("preserves filtering for callers that do not opt in", async () => {
    const db = await getTestDatabase();
    for (const includeEquipped of [undefined, false]) {
      const rows = await fetchUserJutsus(db, USER, {
        stat: ["Ninjutsu"],
        includeEquipped,
      });
      expect(rows.map((row) => row.jutsuId).sort()).toEqual(["pve-nin", "pvp-nin"]);
    }
  });
});
