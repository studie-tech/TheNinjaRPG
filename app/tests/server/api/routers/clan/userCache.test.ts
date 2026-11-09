import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { HIDEOUT_COST, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import {
  actionLog,
  clan,
  conversation,
  gameSetting,
  quest,
  questHistory,
  sector,
  userData,
  userVote,
  village,
  villageStructure,
} from "@/drizzle/schema";
import * as clanLogic from "@/libs/clan";
import { clanRouter } from "@/server/api/routers/clan";
import * as profileApi from "@/server/api/routers/profile";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { InstantNewQuestObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import type { UserDeltaResponse } from "@/validators/userCache";
import {
  insertClans,
  insertQuests,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import { comparableTrackers } from "../../../../setup/quest";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { countUserReads } from "../../../../setup/userReads";

const userId = "clan-membership-actor";
const clanId = "membership-faction";
const strongholdId = "membership-stronghold";
const key = [["profile", "getUser"], { type: "query" }];
const content = {
  objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: [],
};

describeWithDatabase("clan village membership progression", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      questHistory,
      quest,
      userVote,
      gameSetting,
      conversation,
      sector,
      villageStructure,
      clan,
      userData,
      village,
    );
    const db = await getTestDatabase();
    await db.insert(village).values([
      {
        id: strongholdId,
        name: "Membership Stronghold",
        sector: 1,
        kageId: "leader",
        type: "STRONGHOLD",
      },
      {
        id: VILLAGE_SYNDICATE_ID,
        name: "Syndicate",
        sector: 2,
        kageId: "leader",
        type: "OUTLAW",
      },
    ]);
    await insertClans([
      {
        id: clanId,
        name: "Membership Faction",
        villageId: strongholdId,
        leaderId: "leader",
        bank: HIDEOUT_COST,
      },
    ]);
    await insertUsers([
      {
        userId,
        username: "MembershipActor",
        role: "OWNER",
        rank: "JONIN",
        level: 50,
        villageId: strongholdId,
        clanId,
        isOutlaw: true,
        status: "AWAKE",
        primaryElement: "Fire",
        secondaryElement: "Water",
        regeneration: 0,
        updatedAt: new Date(),
        regenAt: new Date(),
      },
      {
        userId: "leader",
        username: "MembershipLeader",
        rank: "JONIN",
        villageId: strongholdId,
        clanId,
        isOutlaw: true,
      },
    ]);
    await insertUserVotes([{ userId }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "leaveClan",
    "kickMember",
    "instantJoinAndLead",
    "purchaseHideout",
  ] as const)(
    "%s reconciles changed village progression without hydrating for confirmation",
    async (method) => {
      const db = await getTestDatabase();
      const isJoining = method === "instantJoinAndLead";
      const isPurchasing = method === "purchaseHideout";
      const source = isJoining || isPurchasing ? VILLAGE_SYNDICATE_ID : strongholdId;
      const destination = isJoining
        ? strongholdId
        : isPurchasing
          ? undefined
          : VILLAGE_SYNDICATE_ID;
      await db
        .update(userData)
        .set({ villageId: source, clanId: isJoining ? null : clanId })
        .where(eq(userData.userId, userId));
      if (isPurchasing) {
        await db
          .update(clan)
          .set({ villageId: source, leaderId: userId })
          .where(eq(clan.id, clanId));
        await db.insert(villageStructure).values({
          id: "syndicate-home",
          villageId: source,
          name: "Home",
          route: "/home",
          image: "",
        });
        vi.spyOn(clanLogic, "checkIfSectorIsAvailable").mockResolvedValue(true);
      }
      await insertQuests([
        {
          id: "source-achievement",
          questType: "achievement",
          requiredVillage: source,
          content,
          hidden: false,
        },
        ...(destination
          ? [
              {
                id: "destination-achievement",
                questType: "achievement" as const,
                requiredVillage: destination,
                content,
                hidden: false,
              },
            ]
          : []),
      ]);
      const profile = callerForDatabase(profileRouter, userId, db);
      const initial = await profile.getUser();
      expect(initial.achievementProgress.map((entry) => entry.questId)).toContain(
        "source-achievement",
      );
      const client = new QueryClient();
      client.setQueryData(key, initial);
      const getUser = vi.fn(() => profile.getUser());
      const observer = new QueryObserver(client, {
        queryKey: key,
        queryFn: getUser,
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => {});
      try {
        const revision = prepareUserUpdate(client, key);
        const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
        const caller = callerForDatabase(clanRouter, userId, db);
        const result: UserDeltaResponse =
          method === "kickMember"
            ? await caller.kickMember({ clanId, memberId: userId })
            : method === "purchaseHideout"
              ? await caller.purchaseHideout({ clanId, sector: 301 })
              : await caller[method]({ clanId });
        expect(result.success, result.message).toBe(true);
        expect(hydration).not.toHaveBeenCalled();
        if (method === "purchaseHideout")
          await client.invalidateQueries({ queryKey: key, exact: true });
        else
          await updateUserCache(client, key, result.userPatch, {
            revision,
            achievementProgress: result.achievementProgress,
            ...(result.userDelta ? { delta: result.userDelta } : {}),
          });
        expect(getUser).toHaveBeenCalledTimes(1);
        const cached = client.getQueryData<typeof initial>(key)!;
        const canonical = await profile.getUser();
        expect(cached.userData?.villageId).toBe(
          destination ?? canonical.userData?.villageId,
        );
        expect(cached.userData?.villageId).not.toBe(source);
        expect(comparableTrackers(cached.userData?.questData)).toEqual(
          comparableTrackers(canonical.userData?.questData),
        );
        expect(cached.userData?.userQuests).toEqual(canonical.userData?.userQuests);
        expect(
          cached.achievementProgress.map(
            ({ startedAt: _startedAt, ...entry }) => entry,
          ),
        ).toEqual(
          canonical.achievementProgress.map(
            ({ startedAt: _startedAt, ...entry }) => entry,
          ),
        );
        expect(cached.userData?.regeneration).toBe(canonical.userData?.regeneration);
        expect(result.userPatch).toBeUndefined();
        expect(result.achievementProgress).toBeUndefined();
      } finally {
        unsubscribe();
        client.clear();
      }
    },
  );

  it("does not publish clan cleanup when the departure's recovery claim loses", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, userId));
    await db.update(clan).set({ leaderId: userId }).where(eq(clan.id, clanId));
    const raced = beforeStatements(db, userData, [
      async () => {
        await db
          .update(userData)
          .set({ autoWakeUp: false })
          .where(eq(userData.userId, userId));
      },
    ]);
    const result = await callerForDatabase(clanRouter, userId, raced).leaveClan({
      clanId,
    });
    expect(result.success).toBe(false);
    expect(result.actionNotice).toBeUndefined();
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ status: "ASLEEP", clanId });
    expect(await db.query.clan.findFirst({ where: eq(clan.id, clanId) })).toMatchObject(
      { leaderId: userId },
    );
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it.each(["ASLEEP", "HOSPITALIZED"] as const)(
    "recovers a %s member with the departure and then finishes clan cleanup",
    async (status) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({
          status,
          autoWakeUp: true,
          regenAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        })
        .where(eq(userData.userId, userId));
      const result = await callerForDatabase(clanRouter, userId, db).leaveClan({
        clanId,
      });
      expect(result.success).toBe(true);
      expect(result.actionNotice).toContain(
        status === "ASLEEP" ? "woke you up" : "hospital for free",
      );
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
      ).toMatchObject({
        status: "AWAKE",
        clanId: null,
        villageId: VILLAGE_SYNDICATE_ID,
      });
      expect(await db.query.actionLog.findMany()).toHaveLength(1);
    },
  );

  it("keeps a clan-only departure projection narrow when the village stays the same", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ isOutlaw: false })
      .where(eq(userData.userId, userId));
    const result = await callerForDatabase(clanRouter, userId, db).leaveClan({
      clanId,
    });
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({ clanId: null, clan: null });
    expect(result.userPatch?.questData).toBeUndefined();
    expect(result.userPatch?.userQuests).toBeUndefined();
    expect(result.achievementProgress).toBeUndefined();
  });

  it.each([false, true])(
    "returns saved leadership fields when demoting a member (self=%s)",
    async (isSelf) => {
      const db = await getTestDatabase();
      const memberId = isSelf ? userId : "demoted-member";
      if (!isSelf)
        await insertUsers([
          {
            userId: memberId,
            username: "DemotedMember",
            rank: "JONIN",
            villageId: strongholdId,
            clanId,
            isOutlaw: true,
          },
        ]);
      await db
        .update(clan)
        .set({
          coLeader1: memberId,
          coLeader2: "other-coleader",
          assassin1: memberId,
          assassin2: "other-assassin",
          elderNomineeId: memberId,
        })
        .where(eq(clan.id, clanId));
      const counted = countUserReads(db);
      const result = await callerForDatabase(
        clanRouter,
        userId,
        counted.client,
      ).demoteMember({ clanId, memberId });
      expect(result.success).toBe(true);
      expect(counted.getReads()).toBe(isSelf ? 1 : 2);
      expect(result.userPatch).toEqual({
        clan: {
          id: clanId,
          coLeader1: null,
          coLeader2: "other-coleader",
          coLeader3: null,
          assassin1: null,
        },
      });
      const saved = await db.query.clan.findFirst({ where: eq(clan.id, clanId) });
      expect(saved).toMatchObject({
        ...result.userPatch?.clan,
        leaderId: "leader",
        assassin2: "other-assassin",
        elderNomineeId: memberId,
        bank: HIDEOUT_COST,
      });
    },
  );

  it("rejects self-promotion using the actor's single opening read", async () => {
    const db = await getTestDatabase();
    const counted = countUserReads(db);
    expect(
      await callerForDatabase(clanRouter, userId, counted.client).promoteMember({
        clanId,
        memberId: userId,
      }),
    ).toMatchObject({ success: false, message: "Not yourself" });
    expect(counted.getReads()).toBe(1);
    expect(await db.query.clan.findFirst({ where: eq(clan.id, clanId) })).toMatchObject(
      { leaderId: "leader", coLeader1: null },
    );
  });

  it("reuses rich actor sources when a staff member removes their own clan membership", async () => {
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ type: "VILLAGE" })
      .where(eq(village.id, strongholdId));
    await db
      .update(userData)
      .set({ isOutlaw: false })
      .where(eq(userData.userId, userId));
    await db
      .update(clan)
      .set({ coLeader1: userId, elderNomineeId: userId })
      .where(eq(clan.id, clanId));
    const counted = countUserReads(db);
    const result = await callerForDatabase(
      clanRouter,
      userId,
      counted.client,
    ).kickMember({ clanId, memberId: userId });
    expect(result.success).toBe(true);
    expect(counted.getReads()).toBe(1);
    expect(result.userPatch).toMatchObject({ clanId: null, clan: null });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ clanId: null, villageId: strongholdId });
    expect(await db.query.clan.findFirst({ where: eq(clan.id, clanId) })).toMatchObject(
      { leaderId: "leader", coLeader1: null, elderNomineeId: null },
    );
  });

  it("returns the saved successor and nominee fields after removing another leader", async () => {
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ type: "VILLAGE" })
      .where(eq(village.id, strongholdId));
    await db
      .update(clan)
      .set({
        coLeader1: userId,
        coLeader2: "other-coleader",
        elderNomineeId: "leader",
        assassin1: "leader",
      })
      .where(eq(clan.id, clanId));
    const counted = countUserReads(db);
    const result = await callerForDatabase(
      clanRouter,
      userId,
      counted.client,
    ).kickMember({ clanId, memberId: "leader" });
    expect(result.success).toBe(true);
    expect(counted.getReads()).toBe(2);
    expect(result.userPatch).toEqual({
      clan: {
        id: clanId,
        leaderId: userId,
        coLeader1: null,
        coLeader2: "other-coleader",
        coLeader3: null,
        elderNomineeId: null,
      },
    });
    expect(await db.query.clan.findFirst({ where: eq(clan.id, clanId) })).toMatchObject(
      { ...result.userPatch?.clan, assassin1: "leader", bank: HIDEOUT_COST },
    );
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }),
    ).toMatchObject({ clanId: null });
  });

  it("reconciles child quest effects after joining a stronghold without publishing a partial update", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ villageId: VILLAGE_SYNDICATE_ID, clanId: null })
      .where(eq(userData.userId, userId));
    await insertQuests([
      {
        id: "destination-achievement",
        questType: "achievement",
        requiredVillage: strongholdId,
        content,
        hidden: false,
      },
      {
        id: "destination-tier",
        questType: "tier",
        requiredVillage: strongholdId,
        requiredLevel: 1,
        maxLevel: 100,
        hidden: false,
        content: {
          ...content,
          objectives: [
            InstantNewQuestObjective.parse({
              id: "start-child",
              task: "new_quest",
              newQuestIds: ["child-mission"],
            }),
          ],
        },
      },
      {
        id: "child-mission",
        name: "Child Mission",
        questType: "mission",
        requiredVillage: strongholdId,
        content,
        hidden: false,
      },
    ]);
    await db.insert(questHistory).values({
      id: "paused-tier",
      userId,
      questId: "destination-tier",
      questType: "tier",
    });
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    const client = new QueryClient();
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: getUser,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
      const result = await callerForDatabase(clanRouter, userId, db).instantJoinAndLead(
        { clanId },
      );
      expect(result.success, result.message).toBe(true);
      expect(hydration).not.toHaveBeenCalled();
      expect(
        await db.query.questHistory.findFirst({
          where: eq(questHistory.questId, "child-mission"),
        }),
      ).toBeUndefined();
      expect(result.userPatch).toBeUndefined();
      expect(result.achievementProgress).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      await updateUserCache(client, key, result.userPatch, {
        revision,
        achievementProgress: result.achievementProgress,
        ...(result.userDelta ? { delta: result.userDelta } : {}),
      });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(client.getQueryData<typeof initial>(key)?.notifications).toContainEqual(
        expect.objectContaining({ name: "Started new quest: Child Mission" }),
      );
      const cached = await profile.getUser();
      expect(cached.userData?.villageId).toBe(strongholdId);
      expect(cached.userData?.userQuests.map((entry) => entry.questId).sort()).toEqual([
        "child-mission",
        "destination-tier",
      ]);
      expect(cached.userData?.questData?.map((tracker) => tracker.id).sort()).toEqual([
        "child-mission",
        "destination-achievement",
        "destination-tier",
      ]);
      expect(cached.achievementProgress.map((entry) => entry.questId)).toEqual([
        "destination-achievement",
      ]);
    } finally {
      unsubscribe();
      client.clear();
    }
  });
});
