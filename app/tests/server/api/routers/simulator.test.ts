/// <reference types="bun-types/test" />

import { beforeEach, expect, it } from "bun:test";
import { desc, eq } from "drizzle-orm";
import { damageSimulation } from "@/drizzle/schema";
import { simulatorRouter } from "@/server/api/routers/simulator";
import { damageSimulationStateSchema } from "@/validators/combat";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const state = damageSimulationStateSchema.parse({
  attacker: {},
  defender: {},
  action: {},
});

describeWithDatabase("damage simulation history", () => {
  beforeEach(async () => {
    await resetTables(damageSimulation);
  });

  const seed = async (count: number) => {
    const db = await getTestDatabase();
    const base = Date.now() - 60 * 60 * 1000;
    await db.insert(damageSimulation).values(
      Array.from({ length: count }, (_, i) => ({
        id: `sim-${String(i).padStart(2, "0")}`,
        userId: "simulator-user",
        state,
        createdAt: new Date(base + i * 1000),
      })),
    );
    await db.insert(damageSimulation).values({
      id: "other-user-sim",
      userId: "other-user",
      state,
      createdAt: new Date(base - 1000),
    });
    return db;
  };

  it.each([
    [5, 6],
    [19, 20],
    [20, 20],
    [25, 20],
  ])("keeps the newest entries when %i exist", async (existing, expected) => {
    const db = await seed(existing);
    const caller = await callerFor(simulatorRouter, "simulator-user");
    expect(await caller.createDamageSimulation(state)).toMatchObject({ success: true });

    const rows = await db
      .select({ id: damageSimulation.id })
      .from(damageSimulation)
      .where(eq(damageSimulation.userId, "simulator-user"))
      .orderBy(desc(damageSimulation.createdAt));
    const seededKept = Array.from(
      { length: expected - 1 },
      (_, i) => `sim-${String(existing - 1 - i).padStart(2, "0")}`,
    );
    expect(rows).toHaveLength(expected);
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining(seededKept));
    expect(
      rows.map((row) => row.id).filter((id) => !id.startsWith("sim-")),
    ).toHaveLength(1);

    const other = await db
      .select({ id: damageSimulation.id })
      .from(damageSimulation)
      .where(eq(damageSimulation.userId, "other-user"));
    expect(other).toHaveLength(1);
  });

  it("deletes only the caller's own simulation", async () => {
    const db = await seed(1);
    const caller = await callerFor(simulatorRouter, "simulator-user");
    expect(await caller.deleteDamageSimulation({ id: "sim-00" })).toMatchObject({
      success: true,
    });
    expect(await caller.deleteDamageSimulation({ id: "other-user-sim" })).toEqual({
      success: false,
      message: "Entry not found",
    });
    expect(await caller.deleteDamageSimulation({ id: "missing-sim" })).toEqual({
      success: false,
      message: "Entry not found",
    });
    const rows = await db.select({ id: damageSimulation.id }).from(damageSimulation);
    expect(rows.map((row) => row.id)).toEqual(["other-user-sim"]);
  });
});
