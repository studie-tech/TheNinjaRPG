// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const caller = (userId: string) => callerFor(profileRouter, userId);

const createUser = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: "color-user",
      username: "ColorUser",
      reputationPoints: 30,
      ...patch,
    } as never,
  ]);
};

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database
    .select()
    .from(userData)
    .where(eq(userData.userId, "color-user"));
  return user;
};

describeWithDatabase("profile tavern color purchases", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData);
  });

  it("charges username and title as independent 10-reputation purchases", async () => {
    await createUser();
    const api = await caller("color-user");
    expect((await api.updateTavernColor({ target: "username", color: "NAVY" })).success).toBe(true);
    expect((await api.updateTavernColor({ target: "title", color: "COBALT" })).success).toBe(true);

    const user = await readUser();
    expect(user?.tavernUsernameColor).toBe("NAVY");
    expect(user?.tavernTitleColor).toBe("COBALT");
    expect(user?.reputationPoints).toBe(10);
  });

  it("returns to DEFAULT for free", async () => {
    await createUser({ reputationPoints: 0, tavernUsernameColor: "NAVY" });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "DEFAULT",
    });
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user?.tavernUsernameColor).toBe("DEFAULT");
    expect(user?.reputationPoints).toBe(0);
  });

  it("rejects insufficient reputation without changing the setting", async () => {
    await createUser({ reputationPoints: 9 });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "title",
      color: "GOLD",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not enough/i);
    expect((await readUser())?.tavernTitleColor).toBe("DEFAULT");
  });

  it("rejects unchanged selections", async () => {
    await createUser();
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "DEFAULT",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unchanged/i);
  });

  it("rejects banned users", async () => {
    await createUser({ isBanned: true });
    const result = await (await caller("color-user")).updateTavernColor({
      target: "username",
      color: "SLATE",
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/banned/i);
  });

  it("writes an action log only after a successful change", async () => {
    await createUser();
    const api = await caller("color-user");
    await api.updateTavernColor({ target: "username", color: "NAVY" });
    await api.updateTavernColor({ target: "username", color: "NAVY" });
    const database = await getTestDatabase();
    const logs = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.userId, "color-user"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.changes).toEqual([
      "Tavern username color changed from DEFAULT to NAVY (-10 reputation)",
    ]);
  });

  it("cannot overspend when two purchases race", async () => {
    await createUser({ reputationPoints: 10 });
    const api = await caller("color-user");
    const results = await Promise.all([
      api.updateTavernColor({ target: "username", color: "NAVY" }),
      api.updateTavernColor({ target: "title", color: "COBALT" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const user = await readUser();
    expect(user?.reputationPoints).toBe(0);
    expect(
      [user?.tavernUsernameColor, user?.tavernTitleColor].filter(
        (color) => color !== "DEFAULT",
      ),
    ).toHaveLength(1);
  });

  it("rejects a stale username color change after a concurrent update", async () => {
    await createUser({ reputationPoints: 20 });
    const api = await caller("color-user");
    const results = await Promise.all([
      api.updateTavernColor({ target: "username", color: "NAVY" }),
      api.updateTavernColor({ target: "username", color: "COBALT" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(1);
    expect(
      results.find((result) => !result.success)?.message,
    ).toMatch(/could not update tavern color/i);

    const user = await readUser();
    expect(user?.reputationPoints).toBe(10);
    expect(["NAVY", "COBALT"]).toContain(user?.tavernUsernameColor);

    const database = await getTestDatabase();
    const logs = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.userId, "color-user"));
    expect(logs).toHaveLength(1);
    const changes = logs[0]?.changes;
    expect(Array.isArray(changes)).toBe(true);
    if (!Array.isArray(changes)) {
      throw new Error("Expected action log changes to be an array");
    }
    expect(changes[0]).toMatch(
      /^Tavern username color changed from DEFAULT to (NAVY|COBALT)/,
    );
  });
});
