import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { gameAsset, item, jutsu } from "@/drizzle/schema";
import type { ZodAllTags } from "@/validators/combat";
import { insertItems } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0180_cuddly_layla_miller.sql", import.meta.url),
  "utf8",
);
const fixtures = [
  {
    id: "vZWi1VTcqPVk0vVAin7sk",
    name: "Fire Elemental",
    effects: [
      {
        type: "damage",
        power: 26,
        rounds: 0,
        target: "INHERIT",
        elements: ["Fire"],
        appearSfx: "",
        direction: "offence",
        calculation: "formula",
        description: "placeholder",
        disappearSfx: "",
        generalTypes: ["Highest"],
        powerPerLevel: 0,
        appearAnimation: "",
        staticAnimation: "",
        staticAssetPath: "",
        residualModifier: 0,
        disappearAnimation: "",
        allowBloodlineDamageDecrease: true,
        allowBloodlineDamageIncrease: true,
      },
    ],
    after: [
      {
        type: "damage",
        power: 26,
        rounds: 0,
        target: "INHERIT",
        elements: ["Fire"],
        appearSfx: "epidemic-0f59bf72-207b-4520-b726-ff9fdd819406",
        direction: "offence",
        calculation: "formula",
        description: "placeholder",
        disappearSfx: "",
        generalTypes: ["Highest"],
        powerPerLevel: 0,
        appearAnimation: "-HayGcXm_avWhsjcUgRrP",
        staticAnimation: "",
        staticAssetPath: "",
        residualModifier: 0,
        disappearAnimation: "",
        allowBloodlineDamageDecrease: true,
        allowBloodlineDamageIncrease: true,
        animationScale: 1.5,
        animationOffsetY: 0.3,
        projectileAnimation: "TnrFireBoltAuditNov15",
        projectileScale: 3,
      },
    ],
    updatedAt: "2026-02-04 15:09:21.011",
  },
  {
    id: "FPPfHAAHWANWlpAvnt2os",
    name: "Moon Pie",
    effects: [
      {
        type: "heal",
        power: 3,
        rounds: 0,
        target: "INHERIT",
        direction: "offence",
        calculation: "percentage",
        description: "placeholder",
        powerPerLevel: 0,
        appearAnimation: "heal",
        staticAnimation: "heal",
        staticAssetPath: "",
        disappearAnimation: "heal",
      },
    ],
    after: [
      {
        type: "heal",
        power: 3,
        rounds: 0,
        target: "INHERIT",
        direction: "offence",
        calculation: "percentage",
        description: "placeholder",
        powerPerLevel: 0,
        appearAnimation: "w0Pz0vwhSYGFop7bowdtI",
        staticAnimation: "",
        staticAssetPath: "",
        disappearAnimation: "",
        animationScale: 1.5,
        animationOffsetY: 0.3,
        appearSfx: "epidemic-07381e8f-01ad-41cf-8dd7-8a84a34e2976",
      },
    ],
    updatedAt: "2024-08-30 04:12:03.896",
  },
];
const existingAssets = [
  "-HayGcXm_avWhsjcUgRrP",
  "epidemic-07381e8f-01ad-41cf-8dd7-8a84a34e2976",
  "epidemic-0f59bf72-207b-4520-b726-ff9fdd819406",
  "w0Pz0vwhSYGFop7bowdtI",
];

it("limits the combat presentation migration to cosmetic fields with version and dependency guards", () => {
  const updates = migration.match(/UPDATE `(Jutsu|Item)` SET [\s\S]*?;(?=\n|$)/g) ?? [];
  expect(updates).toHaveLength(2082);
  const allowed = new Set([
    "appearAnimation",
    "staticAnimation",
    "disappearAnimation",
    "staticAssetPath",
    "appearSfx",
    "disappearSfx",
    "appearSfxPrimary",
    "animationScale",
    "animationOffsetY",
    "projectileAnimation",
    "projectileScale",
    "groundStyle",
    "groundOpacity",
    "groundFeather",
    "target",
  ]);
  for (const update of updates) {
    expect(update).toContain("AND `updatedAt` =");
    expect(update).toContain("AND `effects` = CAST(");
    const setter = update.slice(0, update.indexOf("\nWHERE"));
    for (const match of setter.matchAll(/'\$\[\d+\]\.(\w+)'/g))
      expect(allowed.has(match[1]!)).toBe(true);
    expect(setter).not.toContain("projectileSfx");
    expect(setter).not.toMatch(/`(?:power|range|cooldown|cost|target|method)` =/);
  }
  expect(migration).not.toContain("--> statement-breakpoint");
});

describeWithDatabase("combat presentation migration", () => {
  beforeEach(async () => {
    await resetTables(item, jutsu, gameAsset);
    await insertItems(
      fixtures.map((fixture) => ({
        id: fixture.id,
        name: fixture.name,
        effects: fixture.effects as ZodAllTags[],
        updatedAt: new Date(fixture.updatedAt.replace(" ", "T") + "Z"),
        cost: 9876,
        cooldown: 7,
      })),
    );
    const db = await getTestDatabase();
    await db.insert(gameAsset).values(
      existingAssets.map((id) => ({
        id,
        name: id,
        type: "SFX" as const,
        image: "https://example.com/fixture.png",
        url: "https://example.com/fixture.wav",
      })),
    );
  });
  it("applies reviewed visuals and audio, preserves gameplay fields, and is repeatable", async () => {
    const db = await getTestDatabase();
    const before = await db.query.item.findMany({ orderBy: item.id });
    await runRawSql(migration);
    const after = await db.query.item.findMany({ orderBy: item.id });
    for (const row of before)
      expect(after.find((saved) => saved.id === row.id)).toEqual({
        ...row,
        effects: fixtures.find((f) => f.id === row.id)!.after,
        updatedAt: expect.any(Date),
      });
    expect(await db.query.gameAsset.findMany()).toHaveLength(
      existingAssets.length + 25,
    );
    await runRawSql(migration);
    expect(await db.query.item.findMany({ orderBy: item.id })).toEqual(after);
  });
  it("skips newer staff edits and a conflicting published asset ID", async () => {
    const db = await getTestDatabase();
    await db
      .update(item)
      .set({ updatedAt: new Date("2030-01-01T00:00:00Z") })
      .where(eq(item.id, fixtures[1]!.id));
    await db.insert(gameAsset).values({
      id: "TnrFireBoltAuditNov15",
      name: "Staff artwork",
      type: "ANIMATION",
      image: "https://example.com/staff.png",
      url: "https://example.com/staff.png",
    });
    const before = await db.query.item.findMany({ orderBy: item.id });
    await runRawSql(migration);
    expect(await db.query.item.findMany({ orderBy: item.id })).toEqual(before);
  });
  it("skips a row whose selected cue is missing", async () => {
    const db = await getTestDatabase();
    await db
      .delete(gameAsset)
      .where(eq(gameAsset.id, "epidemic-0f59bf72-207b-4520-b726-ff9fdd819406"));
    const before = await db.query.item.findFirst({
      where: eq(item.id, fixtures[0]!.id),
    });
    await runRawSql(migration);
    expect(
      await db.query.item.findFirst({ where: eq(item.id, fixtures[0]!.id) }),
    ).toEqual(before);
  });
});
