import { afterEach, beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { userData, userRequest, village } from "@/drizzle/schema";
import { villageRouter } from "@/server/api/routers/village";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { beforeStatements } from "../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const MEMBER = "moving-member";

const userOf = async (userId: string) =>
  (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) });

describeWithDatabase("village membership changes", () => {
  beforeEach(async () => {
    await resetTables(userData, userRequest, village);
    const db = await getTestDatabase();
    await db.insert(village).values(["home", "destination"].map((id, index) => ({
      id, name: id, sector: 201 + index, kageId: `${id}-kage`, joinable: true,
    })));
    stubProfile("fetchUpdatedUser", async () => ({
      user: await db.query.userData.findFirst({ where: eq(userData.userId, MEMBER), with: { village: true } }),
      requiresUserRefresh: false,
    }));
  });
  afterEach(resetServerModuleStubs);

  it("keeps reputation credited while a village swap is in flight", async () => {
    await insertUsers([{ userId: MEMBER, username: MEMBER, villageId: "home", role: "MODERATOR", reputationPoints: 40 }]);
    const db = await getTestDatabase();
    const raced = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ reputationPoints: sql`${userData.reputationPoints} + 100` }).where(eq(userData.userId, MEMBER));
    }]);
    const result = await callerForDatabase(villageRouter, MEMBER, raced).swapVillage({ villageId: "destination" });
    expect(result.success).toBe(true);
    expect(await userOf(MEMBER)).toMatchObject({ villageId: "destination", reputationPoints: 140 });
  });

  it("leaves sensei requests and students untouched when the join loses its status guard", async () => {
    await insertUsers([
      { userId: MEMBER, username: MEMBER, villageId: "home", isOutlaw: true, rank: "JONIN" },
      { userId: "student", username: "student", villageId: "home", rank: "GENIN", senseiId: MEMBER },
    ]);
    const db = await getTestDatabase();
    await db.insert(userRequest).values({ id: "sensei-request", senderId: "student", receiverId: MEMBER, status: "PENDING", type: "SENSEI" });
    const raced = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ status: "BATTLE" }).where(eq(userData.userId, MEMBER));
    }]);
    const result = await callerForDatabase(villageRouter, MEMBER, raced).joinVillage({ villageId: "destination" });
    expect(result.success).toBe(false);
    expect((await userOf("student"))?.senseiId).toBe(MEMBER);
    expect(await db.query.userRequest.findMany()).toHaveLength(1);
  });

  it("rejects a banned outlaw's join in terms of joining", async () => {
    await insertUsers([{ userId: MEMBER, username: MEMBER, villageId: "home", isOutlaw: true, rank: "JONIN", isBanned: true }]);
    const result = await callerForDatabase(villageRouter, MEMBER, await getTestDatabase()).joinVillage({ villageId: "destination" });
    expect(result).toMatchObject({ success: false, message: "Cannot join while banned" });
  });

  it("releases students and non-HOME requests on join and swap", async () => {
    for (const operation of ["joinVillage", "swapVillage"] as const) {
      await resetTables(userData, userRequest);
      await insertUsers([
        { userId: MEMBER, username: MEMBER, villageId: "home", isOutlaw: operation === "joinVillage", rank: "JONIN", role: "MODERATOR", reputationPoints: 1000 },
        { userId: "student", username: "student", villageId: "home", rank: "GENIN", senseiId: MEMBER },
      ]);
      const db = await getTestDatabase();
      await db.insert(userRequest).values({ id: "clan-request", senderId: MEMBER, receiverId: "other", status: "PENDING", type: "CLAN" });
      const result = await callerForDatabase(villageRouter, MEMBER, db)[operation]({ villageId: "destination" });
      expect(result.success).toBe(true);
      expect((await userOf("student"))?.senseiId).toBeNull();
      expect(await db.query.userRequest.findMany()).toHaveLength(0);
    }
  });
});
