import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, huntingHabitat, userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

/** Staff tools name another account; that account may be gone by the time they act. */
const STAFF = "staff-target-owner";
const BANNED = "staff-target-banned";
const AI = "staff-target-ai";
const MISSING = "staff-target-missing";

describeWithDatabase("staff actions on other accounts", () => {
  beforeEach(async () => {
    await resetTables(actionLog, huntingHabitat, userData);
    await insertUsers([
      { userId: STAFF, username: "TargetOwner", role: "OWNER" },
      { userId: BANNED, username: "TargetBanned", role: "CONTENT-ADMIN", isBanned: true },
      { userId: AI, username: "TargetBandit", isAi: true },
    ]);
  });

  it("rejects awarding experience to a missing account", async () => {
    const caller = await callerFor(profileRouter, STAFF);
    await expect(
      caller.awardExperience({ targetUserId: MISSING, amount: 10 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects adjusting Seichi Silver of a missing account", async () => {
    const caller = await callerFor(profileRouter, STAFF);
    await expect(
      caller.adjustSeichiSilver({ userId: MISSING, delta: 5, reason: "Event prize" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await (await getTestDatabase()).select().from(actionLog)).toHaveLength(0);
  });

  it("rejects deleting a missing AI", async () => {
    const caller = await callerFor(profileRouter, STAFF);
    await expect(caller.delete({ id: MISSING })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a banned editor before looking at the AI", async () => {
    const caller = await callerFor(profileRouter, BANNED);
    expect(await caller.delete({ id: MISSING })).toEqual({
      success: false,
      message: "You are banned and cannot perform this action",
    });
    expect(await caller.delete({ id: AI })).toEqual({
      success: false,
      message: "You are banned and cannot perform this action",
    });
    const database = await getTestDatabase();
    expect(await database.query.userData.findFirst({ where: eq(userData.userId, AI) })).toBeDefined();
  });

  it("lets a banned editor clone an AI", async () => {
    const caller = await callerFor(profileRouter, BANNED);
    expect(await caller.cloneAi({ id: AI })).toMatchObject({ success: true });
  });
});
