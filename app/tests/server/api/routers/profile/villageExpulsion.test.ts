import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Pusher } from "@/libs/pusher";
import { fetchUpdatedUser } from "@/routers/profile";
import { makeBattleUser } from "../../../../libs/combat/helpers/battleScenario";
const NOW = new Date("2026-09-19T12:00:00Z");
const member = (days: number) => ({ isOutlaw: false, villageId: "village-1", joinedVillageAt: new Date(NOW.getTime() - days * 86_400_000) });
const profileSnapshot = (isOutlaw: boolean, anbuId: string | null = null) => ({
  ...makeBattleUser("user-1"), ...member(isOutlaw ? 0 : 90),
  isOutlaw, villageId: isOutlaw ? "syndicate" : "village-1",
  villagePrestige: isOutlaw ? 100 : -100,
  village: { id: isOutlaw ? "syndicate" : "village-1", type: isOutlaw ? "OUTLAW" : "VILLAGE", structures: [], sectors: [] },
  status: "BATTLE", battleId: "battle-1", anbuId, anbuSquad: anbuId ? { name: "Squad" } : null,
  clanId: null, clan: null, bloodline: null, sageMode: null, activeReskin: null,
  queue: [], cookingJobs: [], raidBuffs: [], userSkills: [], items: [], userQuests: [], completedQuests: [], votes: {}, promotions: [], questData: [],
});

const profileClient = (snapshots: ReturnType<typeof profileSnapshot>[], failCleanup = false, maxReads = Infinity) => {
  const selection = Object.assign(Promise.resolve([]), {
    from: () => selection, where: () => selection, leftJoin: () => selection, innerJoin: () => selection,
    limit: () => selection, orderBy: () => selection,
  });
  let reads = 0;
  let writes = 0;
  const db = {
    select: () => selection,
    query: {
      userData: { findFirst: () => {
        if (reads >= maxReads) throw new Error("Exceeded profile read budget");
        return Promise.resolve(structuredClone(snapshots[Math.min(reads++, snapshots.length - 1)]));
      } },
      war: { findMany: () => Promise.resolve([]) },
      mpvpBattleQueue: { findMany: () => Promise.resolve([]) },
      quest: { findMany: () => Promise.resolve([]) },
      bloodline: { findMany: () => Promise.resolve([]) },
      bloodlineRolls: { findMany: () => Promise.resolve([]) },
      village: { findFirst: () => Promise.resolve({ id: "syndicate", type: "OUTLAW" }) },
      anbuSquad: { findFirst: () => Promise.resolve({ id: "squad-1", name: "Squad", memberCount: 2 }) },
    },
    update: () => ({ set: () => ({ where: async () => {
      const index = writes++;
      if (failCleanup && index === 0) throw new Error("temporary cleanup failure");
      // Expulsion CAS loses; retry cleanup succeeds except the leadership CAS.
      return { rowsAffected: failCleanup ? (index === 3 ? 0 : 1) : 0 };
    } }) }),
  };
  return { db: db as never, reads: () => reads, writes: () => writes };
};

describe("village expulsion recovery", () => {
  beforeEach(() => { vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined); });
  afterEach(() => vi.restoreAllMocks());
  it("bounds repeated expulsion CAS losses", async () => {
    const { db, reads } = profileClient([profileSnapshot(false)], false, 3);
    await expect(fetchUpdatedUser({ client: db, userId: "user-1" })).rejects.toThrow("User state changed concurrently");
    expect(reads()).toBe(3);
  });

  it("does not repeatedly expel an already-outlaw account with inconsistent village data", async () => {
    const snapshot = { ...profileSnapshot(false), isOutlaw: true };
    const { db, reads, writes } = profileClient([snapshot], false, 1);
    const result = await fetchUpdatedUser({ client: db, userId: "user-1" });
    expect(result.user?.isOutlaw).toBe(true);
    expect(reads()).toBe(1);
    expect(writes()).toBe(0);
  });

  it("reloads full membership and relations after a lost expulsion CAS", async () => {
    const fresh = profileSnapshot(true);
    const { db, reads } = profileClient([profileSnapshot(false), fresh]);
    const result = await fetchUpdatedUser({ client: db, userId: "user-1" });
    expect(reads()).toBe(2);
    expect(result.user).toMatchObject({ isOutlaw: true, villageId: "syndicate", joinedVillageAt: fresh.joinedVillageAt, village: { type: "OUTLAW" } });
  });

  it("retries failed ANBU cleanup even after the account is already an outlaw", async () => {
    const { db, writes } = profileClient([profileSnapshot(true, "squad-1")], true);
    await expect(fetchUpdatedUser({ client: db, userId: "user-1" })).rejects.toThrow("temporary cleanup failure");
    const result = await fetchUpdatedUser({ client: db, userId: "user-1" });
    expect(writes()).toBe(4);
    expect(result.user).toMatchObject({ isOutlaw: true, anbuId: null, anbuSquad: null });
    expect(result).toMatchObject({ requiresUserRefresh: true, requiresProgressionRefresh: true });
  });
});
