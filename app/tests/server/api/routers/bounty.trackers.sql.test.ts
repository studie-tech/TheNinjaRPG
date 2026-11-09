import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, bounty, bountySignup, userData } from "@/drizzle/schema";
import { bountyRouter } from "@/server/api/routers/bounty";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const insertBounty = async (status: "OPEN" | "CLAIMED" | "EXPIRED") => {
  const db = await getTestDatabase();
  await db.insert(bounty).values({
    id: "contract",
    targetUserId: "target",
    creatorUserId: "creator",
    amountRyo: 100,
    originalAmountRyo: 100,
    status,
  });
};

describeWithDatabase("bounty tracker removal", () => {
  beforeEach(async () => {
    await resetTables(actionLog, bountySignup, bounty, userData);
    await insertUsers([
      { userId: "staff", role: "MODERATOR-ADMIN" },
      { userId: "player" },
      { userId: "target" },
      { userId: "creator" },
      { userId: "hunter-a" },
      { userId: "hunter-b" },
    ]);
  });

  it("removes every tracker and logs how many were removed", async () => {
    await insertBounty("OPEN");
    const db = await getTestDatabase();
    await db.insert(bountySignup).values(
      ["hunter-a", "hunter-b"].map((hunterUserId) => ({
        id: hunterUserId,
        bountyId: "contract",
        hunterUserId,
      })),
    );
    const result = await (await callerFor(bountyRouter, "staff")).removeAllTrackers({
      bountyId: "contract",
    });
    expect(result.success).toBe(true);
    expect(await db.select().from(bountySignup)).toEqual([]);
    expect(
      await db.select().from(actionLog).where(eq(actionLog.relatedId, "contract")),
    ).toMatchObject([
      {
        userId: "staff",
        tableName: "bounty",
        changes: ["Removed 2 hunters from bounty tracking"],
        relatedMsg: "Staff removed all trackers from bounty: 2 hunters removed",
      },
    ]);
  });

  it("keeps the staff, status and existence guards", async () => {
    const staff = await callerFor(bountyRouter, "staff");
    expect(await staff.removeAllTrackers({ bountyId: "contract" })).toEqual({
      success: false,
      message: "Bounty not found",
    });
    await insertBounty("EXPIRED");
    expect(await staff.removeAllTrackers({ bountyId: "contract" })).toEqual({
      success: false,
      message: "Bounty must be open or claimed",
    });
    const player = await callerFor(bountyRouter, "player");
    expect(await player.removeAllTrackers({ bountyId: "contract" })).toEqual({
      success: false,
      message: "Staff access required",
    });
  });
});
