import { beforeEach, expect, it } from "bun:test";
import { damageSimulation } from "@/drizzle/schema";
import { simulatorRouter } from "@/server/api/routers/simulator";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const activeStates = async () => {
  const rows = await (await getTestDatabase()).query.damageSimulation.findMany();
  return Object.fromEntries(rows.map((row) => [row.id, row.active]));
};

describeWithDatabase("updateDamageSimulation", () => {
  beforeEach(async () => {
    await resetTables(damageSimulation);
    await (await getTestDatabase()).insert(damageSimulation).values(
      [
        { id: "first", userId: "owner" },
        { id: "second", userId: "owner" },
        { id: "foreign", userId: "other" },
      ].map((row) => ({ ...row, state: {} as never, active: 1 })),
    );
  });

  it("deactivates one of the caller's entries by id, and never another user's", async () => {
    const caller = await callerFor(simulatorRouter, "owner");
    await caller.updateDamageSimulation({ id: "first", active: false });
    await caller.updateDamageSimulation({ id: "foreign", active: false });
    expect(await activeStates()).toEqual({ first: 0, second: 1, foreign: 1 });
  });

  it("applies to all of the caller's entries without an id", async () => {
    const caller = await callerFor(simulatorRouter, "owner");
    expect(await caller.updateDamageSimulation({ active: false })).toEqual({
      success: true,
      message: "Damage simulation updated",
    });
    expect(await activeStates()).toEqual({ first: 0, second: 0, foreign: 1 });
  });

  it("treats an empty id like no id", async () => {
    const caller = await callerFor(simulatorRouter, "owner");
    await caller.updateDamageSimulation({ id: "", active: false });
    expect(await activeStates()).toEqual({ first: 0, second: 0, foreign: 1 });
  });
});
