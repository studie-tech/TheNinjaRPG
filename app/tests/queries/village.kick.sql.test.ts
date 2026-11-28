import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { KAGE_KICK_COOLDOWN_DAYS } from "@/drizzle/constants";
import { userData, village } from "@/drizzle/schema";
import { getReducedGainsDays } from "@/libs/train";
import {
  kickVillageMember,
  updateUserDataForJoinVillage,
  updateUserDataForLeaveVillage,
  updateUserDataForSwapVillage,
} from "@/queries/village";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";
import { readUser } from "../setup/userReads";

const requireUser = async (id: string) => {
  const user = await readUser(id);
  if (!user) throw new Error(`Missing fixture user ${id}`);
  return user;
};

const NOW = new Date();
const REASON = "Repeated harassment of village members";

describeWithDatabase("Kage village expulsion", () => {
  beforeEach(async () => {
    await resetTables(userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", sector: 101, kageId: "kage", type: "VILLAGE" },
      {
        id: "other",
        name: "Other",
        sector: 102,
        kageId: "other-kage",
        type: "VILLAGE",
      },
    ]);
    await insertUsers(
      ["kage", "member", "second", "outsider"].map((userId) => ({
        userId,
        username: userId,
        villageId: userId === "outsider" ? "other" : "home",
        rank: "JONIN",
        status: "AWAKE",
        tutorialOn: false,
        isOutlaw: false,
      })),
    );
  });

  it("allows one winner for concurrent kicks and stores the reason with the transition", async () => {
    const db = await getTestDatabase();
    const results = await Promise.all([
      kickVillageMember(db, "kage", "member", "home", NOW, REASON),
      kickVillageMember(db, "kage", "second", "home", NOW, REASON),
    ]);
    expect(results.filter((result) => result.rowsAffected > 0)).toHaveLength(1);
    const members = await Promise.all([requireUser("member"), requireUser("second")]);
    const expelled = members.find((member) => member.isOutlaw);
    expect(expelled).toMatchObject({
      villageKickReason: REASON,
      villagePenaltyWaivers: 2,
      villagePenaltyExempt: true,
    });
    expect(expelled?.villageRejoinBans?.home).toBeDefined();
    expect((await requireUser("kage")).lastKageKickAt).toEqual(NOW);
  });

  it("guards leadership, self-expulsion, foreign membership and tutorial access", async () => {
    const db = await getTestDatabase();
    for (const [actor, target] of [
      ["member", "second"],
      ["kage", "kage"],
      ["kage", "outsider"],
    ] as const) {
      expect(
        (await kickVillageMember(db, actor, target, "home", NOW, REASON)).rowsAffected,
      ).toBe(0);
    }
    await db
      .update(userData)
      .set({ tutorialOn: true, tutorialStep: 0 })
      .where(eq(userData.userId, "member"));
    expect(
      (await kickVillageMember(db, "kage", "member", "home", NOW, REASON)).rowsAffected,
    ).toBe(0);
    expect((await requireUser("kage")).lastKageKickAt).toBeNull();
  });

  it("enforces the exact fourteen-day cooldown boundary", async () => {
    const db = await getTestDatabase();
    await kickVillageMember(db, "kage", "member", "home", NOW, REASON);
    expect(
      (
        await kickVillageMember(
          db,
          "kage",
          "second",
          "home",
          new Date(NOW.getTime() + KAGE_KICK_COOLDOWN_DAYS * 86400000 - 1),
          REASON,
        )
      ).rowsAffected,
    ).toBe(0);
    expect(
      (
        await kickVillageMember(
          db,
          "kage",
          "second",
          "home",
          new Date(NOW.getTime() + KAGE_KICK_COOLDOWN_DAYS * 86400000),
          REASON,
        )
      ).rowsAffected,
    ).toBeGreaterThan(0);
  });

  it("blocks both return paths while waiving the next join and subsequent leave only", async () => {
    const db = await getTestDatabase();
    await kickVillageMember(db, "kage", "member", "home", NOW, REASON);
    const ctx = { userId: "member" };
    let member = await requireUser("member");
    expect(getReducedGainsDays(member)).toBe(0);
    expect(
      (await updateUserDataForJoinVillage(db, { id: "home" }, member, ctx))
        .rowsAffected,
    ).toBe(0);
    expect(
      (
        await updateUserDataForSwapVillage(
          db,
          { id: "home", type: "VILLAGE", sector: 101 },
          member,
          0,
          ctx,
        )
      ).rowsAffected,
    ).toBe(0);
    await updateUserDataForJoinVillage(db, { id: "other" }, member, ctx);
    member = await requireUser("member");
    expect(member.villagePenaltyWaivers).toBe(1);
    expect(getReducedGainsDays(member)).toBe(0);
    await updateUserDataForLeaveVillage(db, member, ctx);
    member = await requireUser("member");
    expect(member.villagePenaltyWaivers).toBe(0);
    expect(getReducedGainsDays(member)).toBe(0);
    await updateUserDataForJoinVillage(db, { id: "other" }, member, ctx);
    member = await requireUser("member");
    expect(member.villagePenaltyExempt).toBe(false);
    expect(getReducedGainsDays(member)).toBeGreaterThan(0);
  });
});
