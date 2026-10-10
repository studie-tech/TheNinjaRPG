// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CLAN_COLOR_CHANGE_REP_COST } from "@/drizzle/constants";
import { clanRouter } from "@/server/api/routers/clan";
import { miscRouter } from "@/server/api/routers/misc";
import { profileRouter } from "@/server/api/routers/profile";
import { callerForDatabase } from "../../setup/testDatabase";

const actor = { userId: "confirmed-award-actor", role: "OWNER", username: "Actor", avatarLight: "", isBanned: false, earnedExperience: 1000, reputationPoints: 100, energyTrainingQueue: [] as unknown[] };
const databaseFor = (rowsAffected = 1, queue: unknown[] = []) => ({
  query: {
    userData: {
      findFirst: vi.fn(async () => ({ ...actor, energyTrainingQueue: queue })),
      findMany: vi.fn(async () => [{ ...actor, energyTrainingQueue: queue }]),
    },
  },
  update: vi.fn(() => ({ set: () => Object.assign(Promise.resolve({ rowsAffected }), {
    where: async () => ({ rowsAffected }),
  }) })),
  insert: vi.fn(() => ({ values: async () => ({ rowsAffected: 1 }) })),
});

describe("confirmed self awards", () => {
  it("returns the committed experience increment without a postwrite profile read", async () => {
    const database = databaseFor();
    const result = await callerForDatabase(profileRouter, actor.userId, database as never)
      .awardExperience({ targetUserId: actor.userId, amount: 25 });
    expect(result).toMatchObject({ success: true, userDelta: { earnedExperience: 25 } });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([1.5, 2.5])("leaves integer-column rounding of experience %s to reconciliation", async (amount) => {
    const database = databaseFor();
    const result = await callerForDatabase(profileRouter, actor.userId, database as never)
      .awardExperience({ targetUserId: actor.userId, amount });
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(2);
  });

  it("refreshes a newly available experience assignment notification", async () => {
    const database = databaseFor();
    database.query.userData.findFirst.mockImplementation(async () => ({ ...actor, earnedExperience: 0 }));
    const result = await callerForDatabase(profileRouter, actor.userId, database as never)
      .awardExperience({ targetUserId: actor.userId, amount: 25 });
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
  });

  it.each([
    { amount: 25, earnedExperience: 1000, queue: [], delta: { earnedExperience: 25 } },
    { amount: 25, earnedExperience: 0, queue: [], delta: undefined },
    { amount: 1.5, earnedExperience: 1000, queue: [], delta: undefined },
    { amount: 25, earnedExperience: 1000, queue: [{}], delta: undefined },
  ])("reconciles mass XP (amount=$amount before=$earnedExperience queue=$queue)", async ({ amount, earnedExperience, queue, delta }) => {
    const database = databaseFor(1, queue);
    database.query.userData.findFirst.mockImplementation(async () => ({ ...actor, earnedExperience, energyTrainingQueue: queue }));
    const result = await callerForDatabase(profileRouter, actor.userId, database as never)
      .awardExperienceToAll({ amount });
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual(delta);
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.update).toHaveBeenCalledTimes(1);
  });

  it("does not confirm an experience increment when no row was written", async () => {
    const result = await callerForDatabase(profileRouter, actor.userId, databaseFor(0) as never)
      .awardExperience({ targetUserId: actor.userId, amount: 25 });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
  });

  it("refreshes reputation objectives when granting reputation counters without another read", async () => {
    const database = databaseFor();
    const result = await callerForDatabase(miscRouter, actor.userId, database as never)
      .awardReputation({ userIds: [actor.userId], reputationAmount: 5, moneyAmount: 25, reason: "Award fixture" });
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.userData.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns a confirmed money-only grant without fetching the profile again", async () => {
    const database = databaseFor();
    const result = await callerForDatabase(miscRouter, actor.userId, database as never)
      .awardReputation({ userIds: [actor.userId], moneyAmount: 25, reason: "Award fixture" });
    expect(result).toMatchObject({ success: true, userDelta: { money: 25 } });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.userData.findMany).toHaveBeenCalledTimes(1);
  });

  it("does not infer fractional BIGINT money rewards", async () => {
    const result = await callerForDatabase(miscRouter, actor.userId, databaseFor() as never)
      .awardReputation({ userIds: [actor.userId], moneyAmount: 0.5, reason: "Award fixture" });
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
  });

  it("refreshes pending queue progression even for known self rewards", async () => {
    const database = databaseFor(1, [{}]);
    const experience = await callerForDatabase(profileRouter, actor.userId, database as never)
      .awardExperience({ targetUserId: actor.userId, amount: 25 });
    const reputation = await callerForDatabase(miscRouter, actor.userId, database as never)
      .awardReputation({ userIds: [actor.userId], reputationAmount: 5, reason: "Award fixture" });
    expect(experience.userDelta).toBeUndefined();
    expect(reputation.userDelta).toBeUndefined();
  });
});

it.each([
  { rowsAffected: 1, queued: false },
  { rowsAffected: 0, queued: false },
  { rowsAffected: 1, queued: true },
])("reconciles faction color from confirmed writes (rows=$rowsAffected queue=$queued)", async ({ rowsAffected, queued }) => {
  const database = databaseFor();
  let updates = 0;
  const update = vi.fn(() => {
    const changedRows = updates++ === 0 ? 1 : rowsAffected;
    return { set: () => Object.assign(Promise.resolve({ rowsAffected: changedRows }), {
      where: async () => ({ rowsAffected: changedRows }),
    }) };
  });
  const findFirst = vi.fn(async () => ({ ...actor, isOutlaw: true, clanId: "color-clan", energyTrainingQueue: queued ? [{}] : [] }));
  const withClan = { ...database, update, query: { ...database.query, userData: { ...database.query.userData, findFirst }, clan: {
    findFirst: vi.fn(async () => ({ id: "color-clan", leaderId: actor.userId, villageId: "color-village", hasHideout: true })),
  } } };
  const result = await callerForDatabase(clanRouter, actor.userId, withClan as never)
    .editClanColor({ clanId: "color-clan", color: "#ABCDEF" });
  expect(result).toMatchObject({ success: true, userPatch: { village: { id: "color-village", hexColor: "#ABCDEF" } } });
  expect(result.userDelta).toEqual(rowsAffected && !queued
    ? { reputationPoints: -CLAN_COLOR_CHANGE_REP_COST } : undefined);
  expect(findFirst).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(2);
  expect(withClan.query.clan.findFirst).toHaveBeenCalledTimes(1);
});
