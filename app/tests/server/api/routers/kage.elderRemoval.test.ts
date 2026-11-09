import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { KAGE_PRESTIGE_REQUIREMENT, TERR_BOT_ID } from "@/drizzle/constants";
import {
  notification,
  userData,
  village,
  villageElderVote,
  villageElderVoteEntry,
} from "@/drizzle/schema";
import { kageRouter } from "@/server/api/routers/kage";
import { settleKageRemoval } from "@/server/utils/kageGovernance";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const now = new Date("2026-10-12T12:00:00.000Z");
const tenureStart = new Date("2026-09-28T12:00:00.000Z");

describeWithDatabase("elder kage removal protection", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(
      notification,
      userData,
      village,
      villageElderVote,
      villageElderVoteEntry,
    );
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "removal-village",
      name: "Removal village",
      kageId: "kage",
      leaderUpdatedAt: tenureStart,
    });
    await insertUsers([
      {
        userId: "kage",
        villageId: "removal-village",
        villagePrestige: KAGE_PRESTIGE_REQUIREMENT,
      },
      ...["elder-1", "elder-2", "elder-3"].map((userId) => ({
        userId,
        villageId: "removal-village",
        rank: "ELDER" as const,
        villagePrestige: KAGE_PRESTIGE_REQUIREMENT,
      })),
    ]);
  });

  afterEach(() => setSystemTime());

  it.each([new Date("2026-10-08T12:00:00.000Z"), new Date("2026-09-28T12:00:00.001Z")])(
    "rejects initiation before 14 days without creating votes or notifications (tenure %s)",
    async (leaderUpdatedAt) => {
      const db = await getTestDatabase();
      await db
        .update(village)
        .set({ leaderUpdatedAt })
        .where(eq(village.id, "removal-village"));
      const result = await (
        await callerFor(kageRouter, "elder-1")
      ).initiateKageRemovalVote({
        villageId: "removal-village",
        reason: "The council requests new leadership",
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("protected");
      expect(await db.query.villageElderVote.findMany()).toHaveLength(0);
      expect(await db.query.notification.findMany()).toHaveLength(0);
    },
  );

  it("allows initiation at exactly 14 days", async () => {
    const result = await (
      await callerFor(kageRouter, "elder-1")
    ).initiateKageRemovalVote({
      villageId: "removal-village",
      reason: "The council requests new leadership",
    });
    expect(result.success).toBe(true);
    const db = await getTestDatabase();
    expect(await db.query.villageElderVote.findMany()).toHaveLength(1);
    const notices = await db.query.notification.findMany();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.userId).toBe("elder-1");
    const recipients = await db.query.userData.findMany();
    expect(
      recipients
        .filter((u) => u.rank === "ELDER")
        .every((u) => u.unreadNotifications === 1),
    ).toBe(true);
    expect(recipients.find((u) => u.userId === "kage")?.unreadNotifications).toBe(0);
  });

  it.each([true, false])(
    "enforces protection on existing motions at removal time (protected: %s)",
    async (isProtected) => {
      const db = await getTestDatabase();
      if (isProtected) {
        await db
          .update(village)
          .set({ leaderUpdatedAt: new Date("2026-10-07T12:00:00.000Z") })
          .where(eq(village.id, "removal-village"));
      }
      await db.insert(villageElderVote).values({
        id: "removal-vote",
        villageId: "removal-village",
        type: "KAGE_REMOVAL",
        initiatedByUserId: "elder-1",
        targetId: "kage",
        endsAt: new Date("2026-10-14T12:00:00.000Z"),
      });
      await db.insert(villageElderVoteEntry).values({
        id: "first-yes",
        voteId: "removal-vote",
        userId: "elder-1",
        vote: "YES",
      });
      const result = await (await callerFor(kageRouter, "elder-2")).voteOnKageRemoval({
        voteId: "removal-vote",
        vote: "YES",
      });
      const [storedVillage, storedKage, vote, notices] = await Promise.all([
        db.query.village.findFirst(),
        db.query.userData.findFirst({ where: eq(userData.userId, "kage") }),
        db.query.villageElderVote.findFirst(),
        db.query.notification.findMany(),
      ]);
      expect(notices).toHaveLength(1);
      expect(notices[0]?.userId).toBe(TERR_BOT_ID);
      expect(result.success).toBe(!isProtected);
      expect(vote?.status).toBe(isProtected ? "REJECTED" : "APPROVED");
      expect(storedKage?.villagePrestige).toBe(KAGE_PRESTIGE_REQUIREMENT);
      if (isProtected) {
        expect(result.message).toContain("protected");
        expect(storedVillage?.kageId).toBe("kage");
      } else {
        expect(storedVillage?.kageId).not.toBe("kage");
        expect(storedVillage?.leaderUpdatedAt).toEqual(now);
      }
    },
  );
  it.each([true, false])(
    "records an eligible elder successor with the public reason and tally (explicit motion: %s)",
    async (withVoteId) => {
      const elder = await callerFor(kageRouter, "elder-1");
      expect(
        (
          await elder.initiateKageRemovalVote({
            villageId: "removal-village",
            reason: "The council requests accountable leadership",
          })
        ).success,
      ).toBe(true);
      const db = await getTestDatabase();
      const vote = (await db.query.villageElderVote.findFirst())!;
      await elder.voteOnKageRemoval({ voteId: vote.id, vote: "YES" });
      expect(
        (
          await (
            await callerFor(kageRouter, "elder-2")
          ).voteOnKageRemoval({ voteId: vote.id, vote: "YES" })
        ).success,
      ).toBe(true);
      expect((await db.query.village.findFirst())?.kageId).toBe("");
      await db
        .update(userData)
        .set({ joinedVillageAt: new Date("2026-01-01") })
        .where(eq(userData.userId, "elder-3"));
      expect(
        (
          await elder.nominateKage({
            villageId: "removal-village",
            voteId: withVoteId ? vote.id : undefined,
            userId: "elder-3",
          })
        ).success,
      ).toBe(true);
      expect((await db.query.village.findFirst())?.kageId).toBe("elder-3");
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "elder-3") }))
          ?.rank,
      ).toBe("JONIN");
      expect(
        (await elder.getRemovalHistory({ villageId: "removal-village" }))[0],
      ).toMatchObject({
        status: "APPROVED",
        yes: 2,
        no: 0,
        successorId: "elder-3",
        reason: "The council requests accountable leadership",
      });
      expect(
        (
          await elder.nominateKage({
            villageId: "removal-village",
            voteId: vote.id,
            userId: "elder-3",
          })
        ).success,
      ).toBe(false);
    },
  );
  it("counts one ballot per elder and leaves the motion open until a majority", async () => {
    const elder = await callerFor(kageRouter, "elder-1");
    await elder.initiateKageRemovalVote({
      villageId: "removal-village",
      reason: "The council requests accountable leadership",
    });
    const db = await getTestDatabase();
    const vote = (await db.query.villageElderVote.findFirst())!;
    expect(
      await elder.voteOnKageRemoval({ voteId: vote.id, vote: "YES" }),
    ).toMatchObject({ success: true });
    expect(await elder.voteOnKageRemoval({ voteId: vote.id, vote: "NO" })).toEqual({
      success: false,
      message: "You have already voted",
    });
    expect(await db.select().from(villageElderVoteEntry)).toMatchObject([
      { userId: "elder-1", vote: "YES" },
    ]);
    expect((await db.query.villageElderVote.findFirst())?.status).toBe("PENDING");
  });

  it.each(["missing", "stale", "wrong-village", "wrong-type", "pending", "unresolved"])(
    "rejects an explicit %s motion and associates an omitted ID with only the current removal",
    async (invalid) => {
      const db = await getTestDatabase();
      await db
        .update(village)
        .set({
          kageId: "",
          leaderUpdatedAt: now,
          kageSchedule: {
            kageId: "",
            tenure: now.toISOString(),
            windows: [],
            publishedAt: null,
            missedStarts: 0,
            paused: false,
            observedAt: now.toISOString(),
            vacancy: { removedUserId: "kage", reason: "Current removal" },
          },
        })
        .where(eq(village.id, "removal-village"));
      await db
        .update(userData)
        .set({ joinedVillageAt: new Date("2026-01-01"), rank: "JONIN" })
        .where(eq(userData.userId, "elder-3"));
      await db.insert(villageElderVote).values({
        id: "current",
        villageId: "removal-village",
        type: "KAGE_REMOVAL",
        status: "APPROVED",
        resolvedAt: now,
        targetId: "kage",
        initiatedByUserId: "elder-1",
        endsAt: now,
      });
      if (invalid !== "missing")
        await db.insert(villageElderVote).values({
          id: "invalid",
          villageId: invalid === "wrong-village" ? "other-village" : "removal-village",
          type: invalid === "wrong-type" ? "WAR_DECLARATION" : "KAGE_REMOVAL",
          status: invalid === "pending" ? "PENDING" : "APPROVED",
          resolvedAt:
            invalid === "unresolved" ? null : invalid === "stale" ? tenureStart : now,
          targetId: "kage",
          initiatedByUserId: "elder-1",
          endsAt: now,
        });
      const elder = await callerFor(kageRouter, "elder-1");
      expect(
        (
          await elder.nominateKage({
            villageId: "removal-village",
            voteId: "invalid",
            userId: "elder-3",
          })
        ).success,
      ).toBe(false);
      expect((await db.query.village.findFirst())?.kageId).toBe("");
      expect(
        (
          await db.query.villageElderVote.findFirst({
            where: eq(villageElderVote.id, "current"),
          })
        )?.successorId,
      ).toBeNull();
      expect(
        (await elder.nominateKage({ villageId: "removal-village", userId: "elder-3" }))
          .success,
      ).toBe(true);
      expect(
        (
          await db.query.villageElderVote.findFirst({
            where: eq(villageElderVote.id, "current"),
          })
        )?.successorId,
      ).toBe("elder-3");
      expect(
        (
          await db.query.villageElderVote.findFirst({
            where: eq(villageElderVote.id, "invalid"),
          })
        )?.successorId ?? null,
      ).toBeNull();
    },
  );
  it("serializes council and defense appointments onto one successor receipt", async () => {
    const elder = await callerFor(kageRouter, "elder-1");
    await elder.initiateKageRemovalVote({
      villageId: "removal-village",
      reason: "The council requests accountable leadership",
    });
    const db = await getTestDatabase();
    const vote = (await db.query.villageElderVote.findFirst())!;
    await elder.voteOnKageRemoval({ voteId: vote.id, vote: "YES" });
    await (await callerFor(kageRouter, "elder-2")).voteOnKageRemoval({
      voteId: vote.id,
      vote: "YES",
    });
    await db.update(userData).set({ joinedVillageAt: new Date("2026-01-01") });
    const results = await Promise.all([
      elder.nominateKage({
        villageId: "removal-village",
        voteId: vote.id,
        userId: "elder-2",
      }),
      elder.nominateKage({ villageId: "removal-village", userId: "elder-3" }),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const incumbent = (await db.query.village.findFirst())!.kageId;
    expect(["elder-2", "elder-3"]).toContain(incumbent);
    expect((await db.query.villageElderVote.findFirst())?.successorId).toBe(incumbent);
    expect(
      (await elder.nominateKage({ villageId: "removal-village", userId: "elder-3" }))
        .success,
    ).toBe(false);
    expect((await db.query.villageElderVote.findFirst())?.successorId).toBe(incumbent);
  });
  it("rejects an orphaned motion once without losing the settlement announcement", async () => {
    const db = await getTestDatabase();
    await db.insert(villageElderVote).values({
      id: "orphaned-motion",
      villageId: "missing-village",
      type: "KAGE_REMOVAL",
      initiatedByUserId: "elder-1",
      targetId: "kage",
      endsAt: now,
    });
    expect((await settleKageRemoval(db, "orphaned-motion", true)).success).toBe(false);
    expect((await db.query.villageElderVote.findFirst())?.status).toBe("REJECTED");
    const notices = await db.query.notification.findMany();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: TERR_BOT_ID });
    expect(notices[0]?.content).toContain("vote did not pass");
    await settleKageRemoval(db, "orphaned-motion", true);
    expect(await db.query.notification.findMany()).toHaveLength(1);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "kage") }))
        ?.unreadNotifications,
    ).toBe(1);
  });
  it("enforces the village cooldown after failure and resets it on a new tenure", async () => {
    const elder = await callerFor(kageRouter, "elder-1");
    await elder.initiateKageRemovalVote({
      villageId: "removal-village",
      reason: "The council requests new leadership",
    });
    const db = await getTestDatabase();
    const vote = (await db.query.villageElderVote.findFirst())!;
    await elder.voteOnKageRemoval({ voteId: vote.id, vote: "NO" });
    await (await callerFor(kageRouter, "elder-2")).voteOnKageRemoval({
      voteId: vote.id,
      vote: "NO",
    });
    const failed = await elder.initiateKageRemovalVote({
      villageId: "removal-village",
      reason: "Another proposal during cooldown",
    });
    expect(failed.success).toBe(false);
    expect(failed.message).toContain("wait");
    await db
      .update(village)
      .set({ leaderUpdatedAt: new Date("2026-09-01T12:00:00Z") })
      .where(eq(village.id, "removal-village"));
    expect(
      (
        await elder.initiateKageRemovalVote({
          villageId: "removal-village",
          reason: "A proposal for the new tenure",
        })
      ).success,
    ).toBe(true);
  });
});
