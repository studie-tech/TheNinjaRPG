import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { CLAN_CREATE_RYO_COST } from "@/drizzle/constants";
import {
  clan,
  userData,
  userRequest,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { clanRouter } from "@/server/api/routers/clan";
import { insertClans, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("clan request visibility", () => {
  beforeEach(async () => {
    await resetTables(userRequest, clan, userData);
    await insertUsers(
      ["leader", "coleader", "member", "applicant", "outsider"].map((userId) => ({
        userId,
        username: userId,
        clanId: ["leader", "coleader", "member"].includes(userId) ? "clan" : null,
      })),
    );
    const db = await getTestDatabase();
    await insertClans([
      {
        id: "clan",
        name: "Clan",
        villageId: "v",
        leaderId: "leader",
        coLeader1: "coleader",
      },
    ]);
    await db.insert(userRequest).values([
      {
        id: "join",
        senderId: "applicant",
        receiverId: "leader",
        status: "PENDING",
        type: "CLAN",
      },
      {
        id: "private",
        senderId: "outsider",
        receiverId: "member",
        status: "PENDING",
        type: "CLAN",
      },
    ]);
  });

  it.each(["leader", "coleader"])(
    "returns requests to authorized %s without serial clan reads",
    async (userId) => {
      const caller = await callerFor(clanRouter, userId);
      const measured = await recordQueries(() =>
        caller.getRequests({ clanLeaderId: "leader" }),
      );
      expect(measured.result.map(({ id }) => id)).toEqual(["join"]);
      expect(measured.statements).toHaveLength(2);
    },
  );

  it("discards speculative requests for ordinary clan members", async () => {
    const member = await callerFor(clanRouter, "member");
    expect(await member.getRequests({ clanLeaderId: "leader" })).toEqual([]);
  });

  it("uses the caller's own requests for applicants regardless of the supplied leader", async () => {
    const applicant = await callerFor(clanRouter, "outsider");
    expect(
      (await applicant.getRequests({ clanLeaderId: "leader" })).map(({ id }) => id),
    ).toEqual(["private"]);
  });
});

describeWithDatabase("clan request authorization", () => {
  beforeEach(async () => {
    await resetTables(userRequest, clan, userData);
    await insertUsers([
      { userId: "leader-a", clanId: "a", villageId: "v", rank: "JONIN" },
      { userId: "leader-b", clanId: "b", villageId: "v", rank: "JONIN" },
      { userId: "applicant", villageId: "v", rank: "GENIN" },
    ]);
    const db = await getTestDatabase();
    await insertClans(
      ["a", "b"].map((id) => ({
        id,
        villageId: "v",
        leaderId: `leader-${id}`,
        leaderOrderId: id,
      })),
    );
    await db.insert(userRequest).values({
      id: "join-b",
      senderId: "applicant",
      receiverId: "leader-b",
      status: "PENDING",
      type: "CLAN",
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const storedRequest = async () =>
    (await getTestDatabase()).query.userRequest.findFirst({
      where: eq(userRequest.id, "join-b"),
    });
  const storedApplicant = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "applicant"),
    });

  it("hides another clan's requests from a leader who names its leader", async () => {
    const leader = await callerFor(clanRouter, "leader-a");
    expect(await leader.getRequests({ clanLeaderId: "leader-b" })).toEqual([]);
  });

  it.each(["acceptRequest", "rejectRequest"] as const)(
    "rejects %s on a request addressed to another clan",
    async (procedure) => {
      const leader = await callerFor(clanRouter, "leader-a");
      expect(await leader[procedure]({ id: "join-b" })).toMatchObject({
        success: false,
        message: "Request is not for your clan",
      });
      expect(await storedRequest()).toMatchObject({ status: "PENDING" });
      expect(await storedApplicant()).toMatchObject({ clanId: null });
    },
  );

  it("rejects accepting a cancelled request", async () => {
    await (await getTestDatabase())
      .update(userRequest)
      .set({ status: "CANCELLED" })
      .where(eq(userRequest.id, "join-b"));
    const leader = await callerFor(clanRouter, "leader-b");
    expect(await leader.acceptRequest({ id: "join-b" })).toMatchObject({
      success: false,
    });
    expect(await storedRequest()).toMatchObject({ status: "CANCELLED" });
    expect(await storedApplicant()).toMatchObject({ clanId: null });
  });

  it("answers a request from a deleted character without throwing", async () => {
    await (await getTestDatabase())
      .delete(userData)
      .where(eq(userData.userId, "applicant"));
    const leader = await callerFor(clanRouter, "leader-b");
    expect(await leader.acceptRequest({ id: "join-b" })).toMatchObject({
      success: false,
      message: "Requester not found",
    });
    expect(await storedRequest()).toMatchObject({ status: "PENDING" });
  });

  it("accepts a pending request addressed to the caller's clan", async () => {
    const leader = await callerFor(clanRouter, "leader-b");
    expect(await leader.acceptRequest({ id: "join-b" })).toMatchObject({
      success: true,
    });
    expect(await storedRequest()).toMatchObject({ status: "ACCEPTED" });
    expect(await storedApplicant()).toMatchObject({ clanId: "b" });
  });
});

describeWithDatabase("clan creation and leadership", () => {
  beforeEach(async () => {
    await resetTables(villageStructure, village, clan, userData);
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "v", name: "Village", sector: 1, kageId: "leader" });
    await db.insert(villageStructure).values({
      id: "hall",
      name: "Clan Hall",
      image: "",
      villageId: "v",
      route: "/clanhall",
      level: 5,
    } as never);
    await insertUsers([
      { userId: "leader", clanId: "a", villageId: "v", rank: "JONIN" },
      { userId: "co1", clanId: "a", villageId: "v", rank: "JONIN" },
      { userId: "co2", clanId: "a", villageId: "v", rank: "JONIN" },
      {
        userId: "member",
        clanId: "a",
        villageId: "v",
        rank: "JONIN",
        money: CLAN_CREATE_RYO_COST,
        villagePrestige: 1000,
      },
    ]);
    await insertClans([
      {
        id: "a",
        name: "Alpha",
        villageId: "v",
        leaderId: "leader",
        coLeader1: "co1",
        coLeader2: "co2",
      },
    ]);
  });

  it("keeps existing members from founding another clan or paying for one", async () => {
    const member = await callerFor(clanRouter, "member");
    expect(await member.createClan({ villageId: "v", name: "Beta" })).toMatchObject({
      success: false,
      message: "Already in a clan",
    });
    expect(
      await (await getTestDatabase()).query.userData.findFirst({
        where: eq(userData.userId, "member"),
      }),
    ).toMatchObject({ clanId: "a", money: CLAN_CREATE_RYO_COST });
    expect(await (await getTestDatabase()).query.clan.findMany()).toHaveLength(1);
  });

  it("moves the old leader into the promoted co-leader's slot", async () => {
    const leader = await callerFor(clanRouter, "leader");
    expect(await leader.promoteMember({ clanId: "a", memberId: "co2" })).toMatchObject({
      success: true,
    });
    expect(
      await (await getTestDatabase()).query.clan.findFirst({ where: eq(clan.id, "a") }),
    ).toMatchObject({
      leaderId: "co2",
      coLeader1: "co1",
      coLeader2: "leader",
      coLeader3: null,
    });
  });
});
