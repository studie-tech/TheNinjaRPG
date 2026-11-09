import { timerClaimFixture } from "../../../setup/gameTimers";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/hourly-maintainance/route";
import {
  bounty,
  bountyContribution,
  bountySignup,
  gameSetting,
  userData,
} from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import { refundBountyContribution } from "@/queries/bounty";
import { bountyRouter, refundBountyContributions } from "@/server/api/routers/bounty";
import { addBountyMoneySchema } from "@/validators/bounty";
import { insertUsers } from "../../../setup/factories";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";
import { beforeStatements, failStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const moneyOf = async (userId: string) =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, userId) })
  )?.money;

const amountOf = async () =>
  (
    await (
      await getTestDatabase()
    ).query.bounty.findFirst({ where: eq(bounty.id, "bounty") })
  )?.amountRyo;

const contributions = async () =>
  (await getTestDatabase()).query.bountyContribution.findMany({
    columns: { id: true, amountRyo: true },
  });

const stale = () => new Date(Date.now() - 8 * 86400_000);
const cronRequest = () => new Request("https://example.com/api/hourly-maintainance");

/** Seed an OPEN bounty funded by its creator, plus a hunter and a backer. */
const seedBounty = async (overrides: Partial<typeof bounty.$inferInsert> = {}) => {
  const db = await getTestDatabase();
  await insertUsers([
    { userId: "creator", username: "creator", money: 0 },
    { userId: "target", username: "target", money: 0, villageId: "elsewhere" },
    { userId: "hunter", username: "hunter", money: 0 },
    { userId: "backer", username: "backer", money: 100 },
  ]);
  await db.insert(bounty).values({
    id: "bounty",
    targetUserId: "target",
    creatorUserId: "creator",
    amountRyo: 500,
    originalAmountRyo: 500,
    status: "OPEN",
    ...overrides,
  });
  await db.insert(bountyContribution).values({
    id: "creator-contribution",
    bountyId: "bounty",
    contributorUserId: "creator",
    amountRyo: 500,
  });
  return db;
};

describeWithDatabase("Bounty money guards", () => {
  beforeEach(async () =>
    resetTables(bounty, bountyContribution, bountySignup, userData),
  );

  it("pays a claimed bounty once when the hunter collects twice at the same time", async () => {
    const db = await seedBounty({
      status: "CLAIMED",
      claimedByUserId: "hunter",
      amountRyo: 1000,
    });
    await db
      .insert(bountySignup)
      .values({ id: "signup", bountyId: "bounty", hunterUserId: "hunter" });
    const results: boolean[] = [];
    const raced = beforeStatements(db, bounty, [
      async () => {
        results.push(
          (
            await (
              await callerFor(bountyRouter, "hunter")
            ).collect({ bountyId: "bounty" })
          ).success,
        );
      },
    ]);
    results.unshift(
      (
        await callerForDatabase(bountyRouter, "hunter", raced).collect({
          bountyId: "bounty",
        })
      ).success,
    );
    expect({ money: await moneyOf("hunter"), results }).toEqual({
      money: 1000,
      results: [false, true],
    });
  });

  it("never drives the backer's money negative when two contributions race", async () => {
    const db = await seedBounty();
    const results: boolean[] = [];
    const raced = beforeStatements(db, userData, [
      async () => {
        results.push(
          (
            await (
              await callerFor(bountyRouter, "backer")
            ).addMoney({ bountyId: "bounty", amountRyo: 100 })
          ).success,
        );
      },
    ]);
    results.unshift(
      (
        await callerForDatabase(bountyRouter, "backer", raced).addMoney({
          bountyId: "bounty",
          amountRyo: 100,
        })
      ).success,
    );
    expect({
      money: await moneyOf("backer"),
      amountRyo: await amountOf(),
      results,
    }).toEqual({ money: 0, amountRyo: 600, results: [false, true] });
  });

  it("refunds a contribution whose bounty is retracted before it is applied", async () => {
    const db = await seedBounty();
    const raced = beforeStatements(db, userData, [
      async () => {
        expect(
          (
            await (
              await callerFor(bountyRouter, "creator")
            ).retract({ bountyId: "bounty" })
          ).success,
        ).toBe(true);
      },
    ]);
    const result = await callerForDatabase(bountyRouter, "backer", raced).addMoney({
      bountyId: "bounty",
      amountRyo: 100,
    });
    expect(result.success).toBe(false);
    expect({
      backer: await moneyOf("backer"),
      creator: await moneyOf("creator"),
    }).toEqual({ backer: 100, creator: 500 });
    expect(await db.query.bountyContribution.findMany()).toEqual([]);
  });

  it("refunds a recorded contribution exactly once when a retract lands before the bounty is raised", async () => {
    const db = await seedBounty();
    const raced = beforeStatements(db, bounty, [
      async () => {
        expect(
          (
            await (
              await callerFor(bountyRouter, "creator")
            ).retract({ bountyId: "bounty" })
          ).success,
        ).toBe(true);
      },
    ]);
    const result = await callerForDatabase(bountyRouter, "backer", raced).addMoney({
      bountyId: "bounty",
      amountRyo: 100,
    });
    expect(result.success).toBe(false);
    expect({
      backer: await moneyOf("backer"),
      creator: await moneyOf("creator"),
    }).toEqual({ backer: 100, creator: 500 });
  });

  it("rejects fractional contributions", () => {
    expect(
      addBountyMoneySchema.safeParse({ bountyId: "bounty", amountRyo: 1.5 }).success,
    ).toBe(false);
  });

  it("does not expose staff-only creator and hunter identities on the board", async () => {
    const db = await seedBounty();
    await db
      .insert(bountySignup)
      .values({ id: "signup", bountyId: "bounty", hunterUserId: "hunter" });
    const board = await (await callerFor(bountyRouter, "backer")).board({
      status: "OPEN",
      limit: 30,
    });
    const [listing] = board.data;
    expect(listing).toMatchObject({ id: "bounty", huntersCount: 1, isCreator: false });
    for (const key of [
      "creator",
      "creatorUserId",
      "hunters",
      "creatorUser",
      "huntingUsers",
    ]) {
      expect((listing as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});

describeWithDatabase("Bounty expiry", () => {
  const spies: { mockRestore: () => void }[] = [];
  beforeEach(async () => {
    await resetTables(bounty, bountyContribution, bountySignup, gameSetting, userData);
    stubCronAuth(() => null);
    spies.push(
      vi.spyOn(gamesettings, "lockWithHourlyTimer").mockResolvedValue({
        ...timerClaimFixture(),
        isNewHour: true,
        response: Response.json(null),
      } as never),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(Sentry, "captureException").mockReturnValue("test-event"),
      vi.spyOn(Sentry, "flush").mockResolvedValue(true),
    );
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
    resetServerModuleStubs();
  });

  it("does not refund a bounty the creator retracted after the expiry listing", async () => {
    const db = await seedBounty({ createdAt: new Date(Date.now() - 8 * 86400_000) });
    stubDatabase(
      beforeStatements(db, bounty, [
        async () => {
          expect(
            (
              await (
                await callerFor(bountyRouter, "creator")
              ).retract({ bountyId: "bounty" })
            ).success,
          ).toBe(true);
        },
      ]),
    );
    const response = await GET(
      new Request("https://example.com/api/hourly-maintainance"),
    );
    expect(response.status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect((await db.query.bounty.findFirst())?.status).toBe("CANCELLED");
  });

  it("expires a stale bounty and refunds its contributions", async () => {
    const db = await seedBounty({ createdAt: new Date(Date.now() - 8 * 86400_000) });
    const response = await GET(
      new Request("https://example.com/api/hourly-maintainance"),
    );
    expect(response.status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect((await db.query.bounty.findFirst())?.status).toBe("EXPIRED");
    expect(await db.query.bountyContribution.findMany()).toEqual([]);
  });

  it("loses nothing when a refund fails after its credit, and the next run pays no more", async () => {
    const db = await seedBounty({ createdAt: stale() });
    const failDelete = async () => {
      throw new Error("Delete failed on purpose");
    };
    stubDatabase(
      beforeStatements(db, bountyContribution, [async () => {}, failDelete]),
    );
    expect((await GET(cronRequest())).status).toBe(500);
    expect(await moneyOf("creator")).toBe(500);
    expect(await contributions()).toEqual([
      { id: "creator-contribution", amountRyo: 0 },
    ]);

    stubDatabase(db);
    expect((await GET(cronRequest())).status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect(await contributions()).toEqual([]);
  });

  it("resumes an EXPIRED bounty whose refund failed before its credit", async () => {
    const db = await seedBounty({ createdAt: stale() });
    stubDatabase(failStatements(db, bountyContribution));
    expect((await GET(cronRequest())).status).toBe(500);
    expect(await moneyOf("creator")).toBe(0);
    expect((await db.query.bounty.findFirst())?.status).toBe("EXPIRED");

    stubDatabase(db);
    expect((await GET(cronRequest())).status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect(await contributions()).toEqual([]);
  });

  it("resumes a CANCELLED bounty left with contributions", async () => {
    await seedBounty({ status: "CANCELLED" });
    expect((await GET(cronRequest())).status).toBe(200);
    expect(await moneyOf("creator")).toBe(500);
    expect(await contributions()).toEqual([]);
  });

  it("never refunds the contributions of a CLAIMED bounty", async () => {
    await seedBounty({ status: "CLAIMED", claimedByUserId: "hunter" });
    expect((await GET(cronRequest())).status).toBe(200);
    expect(await moneyOf("creator")).toBe(0);
    expect(await contributions()).toEqual([
      { id: "creator-contribution", amountRyo: 500 },
    ]);
  });

  it("deletes a row left at 0 without paying it again", async () => {
    const db = await seedBounty({ status: "EXPIRED" });
    await db.update(bountyContribution).set({ amountRyo: 0 });
    expect((await GET(cronRequest())).status).toBe(200);
    expect(await moneyOf("creator")).toBe(0);
    expect(await contributions()).toEqual([]);
  });

  it("drains the contribution of a deleted contributor", async () => {
    const db = await seedBounty({ status: "EXPIRED" });
    await db.delete(userData).where(eq(userData.userId, "creator"));
    expect((await GET(cronRequest())).status).toBe(200);
    expect(await contributions()).toEqual([]);
  });
});

describeWithDatabase("Bounty refund passes", () => {
  beforeEach(async () =>
    resetTables(bounty, bountyContribution, bountySignup, userData),
  );

  it("pays once when a second pass interleaves before the credit", async () => {
    const db = await seedBounty({ status: "EXPIRED" });
    const raced = beforeStatements(db, bountyContribution, [
      () => refundBountyContributions(db, "bounty"),
    ]);
    await refundBountyContributions(raced, "bounty");
    expect(await moneyOf("creator")).toBe(500);
    expect(await contributions()).toEqual([]);
  });

  it("pays once when two passes run at the same time", async () => {
    const db = await seedBounty({ status: "EXPIRED" });
    await Promise.all([
      refundBountyContributions(db, "bounty"),
      refundBountyContributions(db, "bounty"),
    ]);
    expect(await moneyOf("creator")).toBe(500);
    expect(await contributions()).toEqual([]);
  });

  it("credits each contributor their own amount", async () => {
    const db = await seedBounty({ status: "EXPIRED" });
    await db.insert(bountyContribution).values({
      id: "backer-contribution",
      bountyId: "bounty",
      contributorUserId: "backer",
      amountRyo: 40,
    });
    await refundBountyContributions(db, "bounty");
    expect({
      creator: await moneyOf("creator"),
      backer: await moneyOf("backer"),
    }).toEqual({ creator: 500, backer: 140 });
    expect(await contributions()).toEqual([]);
  });

  it("does not pay a contribution again when a pass stopped before its delete", async () => {
    const db = await seedBounty();
    const raced = beforeStatements(db, bounty, [
      async () => {
        await db.update(bounty).set({ status: "CANCELLED" });
        for (const contribution of await db.query.bountyContribution.findMany()) {
          await refundBountyContribution(db, contribution);
        }
      },
    ]);
    const result = await callerForDatabase(bountyRouter, "backer", raced).addMoney({
      bountyId: "bounty",
      amountRyo: 100,
    });
    expect(result.success).toBe(false);
    expect({
      backer: await moneyOf("backer"),
      creator: await moneyOf("creator"),
    }).toEqual({ backer: 100, creator: 500 });
  });
});
