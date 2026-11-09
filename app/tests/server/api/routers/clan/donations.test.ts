import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { FACTION_REPUTATION_TREASURY_LIMIT } from "@/drizzle/constants";
import { actionLog, clan, userData } from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { insertClans, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const MEMBER = "donation-member";
const CLAN = "donation-clan";
const OTHER_CLAN = "donation-other-clan";
const MONEY = 1000;
const REPS = 100;
const BANK = 500;
const TREASURY = FACTION_REPUTATION_TREASURY_LIMIT - 50;
const DONATE_FAILED =
  "Reputation points were not donated; refresh the faction and check your reputation points, membership and the treasury limit";
const DEPOSIT_FAILED =
  "Ryo was not deposited; refresh the clan and check your pocket and membership";

const balances = async () => {
  const database = await getTestDatabase();
  const [member, savedClan, logs] = await Promise.all([
    database.query.userData.findFirst({ where: eq(userData.userId, MEMBER) }),
    database.query.clan.findFirst({ where: eq(clan.id, CLAN) }),
    database.select().from(actionLog),
  ]);
  return {
    money: member?.money,
    reputationPoints: member?.reputationPoints,
    clanId: member?.clanId,
    bank: savedClan?.bank,
    repTreasury: savedClan?.repTreasury,
    logs: logs.length,
  };
};

/** A caller whose client runs `race` just before the transfer statement. */
const callerAfter = async (race?: () => Promise<unknown>) => {
  const database = await getTestDatabase();
  const client = race ? beforeStatements(database, userData, [race]) : database;
  return callerForDatabase(clanRouter, MEMBER, client);
};

const setMember = async (values: Partial<typeof userData.$inferInsert>) =>
  (await getTestDatabase())
    .update(userData)
    .set(values)
    .where(eq(userData.userId, MEMBER));

const deleteClan = async () =>
  (await getTestDatabase()).delete(clan).where(eq(clan.id, CLAN));

/** Donations and deposits move value only when the member's balance and membership and the clan's limits all hold. */
describeWithDatabase("clan donations and deposits", () => {
  beforeEach(async () => {
    await resetTables(actionLog, clan, userData);
    await insertUsers([
      {
        userId: MEMBER,
        clanId: CLAN,
        villageId: "donation-village",
        money: MONEY,
        reputationPoints: REPS,
        isOutlaw: true,
      },
    ]);
    await insertClans([
      {
        id: CLAN,
        name: "Donation Clan",
        leaderId: MEMBER,
        villageId: "donation-village",
        bank: BANK,
        repTreasury: TREASURY,
      },
      {
        id: OTHER_CLAN,
        name: "Other Clan",
        leaderId: MEMBER,
        villageId: "donation-village",
        bank: 0,
        repTreasury: 0,
      },
    ]);
  });

  it("moves donated reputation into the treasury", async () => {
    const result = await (await callerAfter()).clanDonate({
      clanId: CLAN,
      reputationPoints: 30,
    });
    expect(result.success).toBe(true);
    expect(await balances()).toEqual({
      money: MONEY,
      reputationPoints: REPS - 30,
      clanId: CLAN,
      bank: BANK,
      repTreasury: TREASURY + 30,
      logs: 1,
    });
  });

  it("moves deposited ryo into the clan bank", async () => {
    const result = await (await callerAfter()).toBank({ clanId: CLAN, amount: 250 });
    expect(result.success).toBe(true);
    expect(await balances()).toEqual({
      money: MONEY - 250,
      reputationPoints: REPS,
      clanId: CLAN,
      bank: BANK + 250,
      repTreasury: TREASURY,
      logs: 0,
    });
  });

  const donationRaces: Array<
    [string, () => Promise<unknown>, Partial<Awaited<ReturnType<typeof balances>>>]
  > = [
    [
      "the donor's reputation drains",
      () => setMember({ reputationPoints: 20 }),
      { reputationPoints: 20 },
    ],
    [
      "the donor leaves the faction",
      () => setMember({ clanId: null }),
      { clanId: null },
    ],
    [
      "the donor switches to another faction",
      () => setMember({ clanId: OTHER_CLAN }),
      { clanId: OTHER_CLAN },
    ],
    ["the faction is deleted", deleteClan, { bank: undefined, repTreasury: undefined }],
  ];
  for (const [label, race, changed] of donationRaces) {
    it(`donates nothing when ${label} before the transfer`, async () => {
      const before = await balances();
      const result = await (await callerAfter(race)).clanDonate({
        clanId: CLAN,
        reputationPoints: 30,
      });
      expect(result).toEqual({ success: false, message: DONATE_FAILED });
      expect(await balances()).toEqual({ ...before, ...changed });
    });
  }

  it("donates nothing when a concurrent donation fills the treasury before the transfer", async () => {
    const database = await getTestDatabase();
    const filled = FACTION_REPUTATION_TREASURY_LIMIT - 10;
    const before = await balances();
    const result = await (
      await callerAfter(() =>
        database.update(clan).set({ repTreasury: filled }).where(eq(clan.id, CLAN)),
      )
    ).clanDonate({ clanId: CLAN, reputationPoints: 30 });
    expect(result).toEqual({ success: false, message: DONATE_FAILED });
    expect(await balances()).toEqual({ ...before, repTreasury: filled });
  });

  it("takes no reputation from the donor when the treasury is already above its limit", async () => {
    const database = await getTestDatabase();
    const over = FACTION_REPUTATION_TREASURY_LIMIT + 20;
    await database.update(clan).set({ repTreasury: over }).where(eq(clan.id, CLAN));
    const before = await balances();
    const result = await (await callerAfter()).clanDonate({
      clanId: CLAN,
      reputationPoints: 30,
    });
    expect(result.success).toBe(true);
    expect(await balances()).toEqual(before);
  });

  const depositRaces: Array<
    [string, () => Promise<unknown>, Partial<Awaited<ReturnType<typeof balances>>>]
  > = [
    ["the member's pocket drains", () => setMember({ money: 100 }), { money: 100 }],
    ["the member leaves the clan", () => setMember({ clanId: null }), { clanId: null }],
    [
      "the member switches to another clan",
      () => setMember({ clanId: OTHER_CLAN }),
      { clanId: OTHER_CLAN },
    ],
    ["the clan is deleted", deleteClan, { bank: undefined, repTreasury: undefined }],
  ];
  for (const [label, race, changed] of depositRaces) {
    it(`deposits nothing when ${label} before the transfer`, async () => {
      const before = await balances();
      const result = await (await callerAfter(race)).toBank({
        clanId: CLAN,
        amount: 250,
      });
      expect(result).toEqual({ success: false, message: DEPOSIT_FAILED });
      expect(await balances()).toEqual({ ...before, ...changed });
    });
  }
});
