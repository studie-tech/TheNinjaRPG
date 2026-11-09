import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { ROLL_CHANCE } from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  bloodlineRolls,
  gameSetting,
  quest,
  questHistory,
  userData,
} from "@/drizzle/schema";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "natural-roller";
const NO_BLOODLINE =
  "After thorough examination, the doctors conclude you have no bloodline";
const ALREADY_ROLLED = "You have already rolled a bloodline";

const rollAt = (chance: number) => {
  vi.spyOn(crypto, "randomInt").mockImplementation((() =>
    Math.ceil(chance * 1_000_000)) as never);
};
const saved = async () =>
  (await (
    await getTestDatabase()
  ).query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
const rolls = async () => (await getTestDatabase()).select().from(bloodlineRolls);

describeWithDatabase("natural bloodline roll", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      bloodlineRolls,
      bloodline,
      questHistory,
      quest,
      gameSetting,
      userData,
    );
    await insertUsers([
      {
        userId,
        username: "NaturalRoller",
        rank: "GENIN",
        status: "AWAKE",
        regeneration: 0,
      },
    ]);
    await (await getTestDatabase()).insert(bloodline).values(
      (["S", "A", "B", "C"] as const).map((rank) => ({
        id: `line-${rank}`,
        name: `Line ${rank}`,
        rank,
        image: "",
        description: "A bloodline",
        effects: [],
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { chance: 0, rank: "S" },
    { chance: ROLL_CHANCE.S, rank: "A" },
    { chance: ROLL_CHANCE.A, rank: "B" },
    { chance: ROLL_CHANCE.B, rank: "C" },
  ])("grants rank $rank at the lower edge of its range", async ({ chance, rank }) => {
    rollAt(chance);
    const result = await (await callerFor(bloodlineRouter, userId)).roll();
    expect(result).toMatchObject({
      success: true,
      message: `After thorough examination, a bloodline was detected: Line ${rank}`,
    });
    expect(result.userPatch).toBeDefined();
    expect((await saved()).bloodlineId).toBe(`line-${rank}`);
    expect(await rolls()).toMatchObject([
      { type: "NATURAL", bloodlineId: `line-${rank}`, used: 0, pityRolls: 0 },
    ]);
  });

  it("records an empty roll past the last rank", async () => {
    rollAt(ROLL_CHANCE.C);
    const result = await (await callerFor(bloodlineRouter, userId)).roll();
    expect(result).toEqual({ success: false, message: NO_BLOODLINE });
    expect((await saved()).bloodlineId).toBeNull();
    expect(await rolls()).toMatchObject([{ type: "NATURAL", bloodlineId: null }]);
  });

  it("records an empty roll when the rolled rank has no bloodline", async () => {
    await (await getTestDatabase()).delete(bloodline).where(eq(bloodline.rank, "A"));
    rollAt(ROLL_CHANCE.S);
    expect(await (await callerFor(bloodlineRouter, userId)).roll()).toEqual({
      success: false,
      message: NO_BLOODLINE,
    });
    expect(await rolls()).toMatchObject([{ bloodlineId: null }]);
  });

  describe("a concurrent roll", () => {
    const concurrentRoll = async () =>
      (await getTestDatabase())
        .insert(bloodlineRolls)
        .values({ id: "first", userId, type: "NATURAL", bloodlineId: null });

    it("rejects a duplicate empty roll", async () => {
      rollAt(ROLL_CHANCE.C);
      const database = await getTestDatabase();
      const client = beforeStatements(database, bloodlineRolls, [concurrentRoll], {
        operations: ["insert"],
      });
      expect(await callerForDatabase(bloodlineRouter, userId, client).roll()).toEqual({
        success: false,
        message: ALREADY_ROLLED,
      });
      expect(await rolls()).toHaveLength(1);
    });

    it("rejects a duplicate granted roll", async () => {
      rollAt(0);
      const database = await getTestDatabase();
      const client = beforeStatements(database, bloodlineRolls, [concurrentRoll], {
        operations: ["insert"],
      });
      expect(await callerForDatabase(bloodlineRouter, userId, client).roll()).toEqual({
        success: false,
        message: ALREADY_ROLLED,
      });
      expect(await rolls()).toMatchObject([{ id: "first" }]);
    });

    it("grants nothing when the bloodline slot was taken after the claim", async () => {
      rollAt(0);
      const database = await getTestDatabase();
      const takeSlot = () =>
        database
          .update(userData)
          .set({ bloodlineId: "line-C" })
          .where(eq(userData.userId, userId));
      // The first write is the readiness claim; the slot changes before the grant that follows it.
      const client = beforeStatements(database, userData, [() => undefined, takeSlot]);
      expect(await callerForDatabase(bloodlineRouter, userId, client).roll()).toEqual({
        success: false,
        message: ALREADY_ROLLED,
      });
      expect(await rolls()).toHaveLength(0);
    });
  });
});
