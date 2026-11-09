import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { actionLog, mpvpBattleQueue, mpvpBattleUser, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { staffRouter } from "@/server/api/routers/staff";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

/** Force-awake removes a stuck member from a team and cleans the team up once it is empty. */
const STAFF = "awake-staff";
const STUCK = "awake-stuck";
const reason = "Recover a stuck queue member";

describeWithDatabase("force-awake team cleanup", () => {
  beforeEach(async () => {
    await resetTables(actionLog, mpvpBattleUser, mpvpBattleQueue, userData);
    await insertUsers([
      { userId: STAFF, username: "AwakeStaff", role: "OWNER" },
      { userId: STUCK, username: "AwakeStuck", status: "QUEUED", sector: 7 },
    ]);
    const db = await getTestDatabase();
    await db.insert(mpvpBattleQueue).values({
      id: "awake-team",
      battleType: "RAID_BATTLE",
      attackerEntityId: "raid",
      defenderEntityId: "raid",
      sector: 7,
    });
    await db.insert(mpvpBattleUser).values({
      id: "stuck-member",
      userId: STUCK,
      clanBattleId: "awake-team",
      side: "ATTACKER",
      slot: 0,
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("removes the team once its last member is woken", async () => {
    const result = await (await callerFor(staffRouter, STAFF)).forceAwake({
      userId: STUCK,
      reason,
    });
    expect(result.success).toBe(true);
    const db = await getTestDatabase();
    expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(0);
  });

  it("keeps the team for a member who joins during the cleanup", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(
      db,
      mpvpBattleQueue,
      [
        async () => {
          await db.insert(mpvpBattleUser).values({
            id: "joiner",
            userId: "awake-joiner",
            clanBattleId: "awake-team",
            side: "ATTACKER",
            slot: 1,
          });
        },
      ],
      { operations: ["delete"] },
    );
    const result = await callerForDatabase(staffRouter, STAFF, client).forceAwake({
      userId: STUCK,
      reason,
    });
    expect(result.success).toBe(true);
    expect(await db.query.mpvpBattleQueue.findMany()).toEqual([
      expect.objectContaining({ id: "awake-team" }),
    ]);
    expect(await db.query.mpvpBattleUser.findMany()).toEqual([
      expect.objectContaining({ id: "joiner" }),
    ]);
  });
});
