import { beforeEach, expect, it } from "bun:test";
import { combatSharedCooldown, userData } from "@/drizzle/schema";
import { fetchSharedCooldowns } from "@/queries/sharedCooldown";
import { miscRouter } from "@/server/api/routers/misc";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("staff shared cooldown settings", () => {
  beforeEach(async () => {
    await resetTables(combatSharedCooldown, userData);
    await insertUsers([
      { userId: "staff", role: "CONTENT" },
      { userId: "player", role: "USER" },
    ]);
  });

  it("adds, updates and removes a tag without duplicate entries", async () => {
    const caller = await callerFor(miscRouter, "staff");
    expect(await caller.setSharedCooldown({ tag: "clear", rounds: 5 })).toMatchObject({
      success: true,
    });
    expect(await caller.setSharedCooldown({ tag: "clear", rounds: 2 })).toMatchObject({
      success: true,
    });
    expect(await caller.getSharedCooldowns()).toEqual([{ tag: "clear", rounds: 2 }]);
    expect(await caller.removeSharedCooldown({ tag: "clear" })).toMatchObject({
      success: true,
    });
    expect(await caller.getSharedCooldowns()).toEqual([]);
  });

  it("rejects unauthorized edits before writing configuration", async () => {
    const caller = await callerFor(miscRouter, "player");
    expect(await caller.setSharedCooldown({ tag: "clear", rounds: 5 })).toMatchObject({
      success: false,
    });
    expect(await caller.removeSharedCooldown({ tag: "clear" })).toMatchObject({
      success: false,
    });
    expect(await fetchSharedCooldowns(await getTestDatabase())).toEqual([]);
    await expect(caller.getSharedCooldowns()).rejects.toThrow("Not allowed");
  });

  it("validates tag names and whole positive rounds before writes", async () => {
    const caller = await callerFor(miscRouter, "staff");
    await expect(
      caller.setSharedCooldown({ tag: "unknown", rounds: 3 }),
    ).rejects.toThrow();
    await expect(
      caller.setSharedCooldown({ tag: "clear", rounds: 0 }),
    ).rejects.toThrow();
    await expect(
      caller.setSharedCooldown({ tag: "clear", rounds: 1.5 }),
    ).rejects.toThrow();
    expect(await caller.getSharedCooldowns()).toEqual([]);
  });
});
