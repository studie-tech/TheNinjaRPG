import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { notification, userData, villageElderVote } from "@/drizzle/schema";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import type { DrizzleClient } from "@/server/db";
import { rejectWarDeclaration, startClaimedWarDeclaration } from "@/server/utils/war";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const now = new Date("2026-10-12T12:00:00.000Z");

/** Store a declaration motion in the given state and return it as callers hold it. */
const insertVote = async (status: "PENDING" | "APPROVED", endsAt: Date) => {
  const db = await getTestDatabase();
  await insertUsers([{ userId: "kage" }]);
  const vote = {
    id: "vote",
    villageId: "attacker",
    targetId: "defender",
    type: "WAR_DECLARATION" as const,
    initiatedByUserId: "kage",
    status,
    endsAt,
    warType: null,
    targetStructureRoute: null,
  };
  await db.insert(villageElderVote).values(vote);
  return vote;
};

const stored = async () => {
  const db = await getTestDatabase();
  const [vote, notices, kage] = await Promise.all([
    db.query.villageElderVote.findFirst(),
    db.query.notification.findMany(),
    db.query.userData.findFirst(),
  ]);
  return { vote, notices, unread: kage?.unreadNotifications };
};

describeWithDatabase("war declaration settlement", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(notification, userData, villageElderVote);
  });
  afterEach(() => {
    setSystemTime();
  });

  it("starts the cooldown now for a motion rejected inside its window", async () => {
    const vote = await insertVote("PENDING", new Date(now.getTime() + 3_600_000));
    const db = (await getTestDatabase()) as unknown as DrizzleClient;
    await rejectWarDeclaration(db, vote, "rejected", "PENDING");
    const result = await stored();
    expect(result.vote?.status).toBe("REJECTED");
    expect(result.vote?.endsAt).toEqual(now);
    expect(result.notices.map((row) => row.content)).toEqual(["rejected"]);
    expect(result.unread).toBe(1);
  });

  it("keeps the end of a motion that expired on its own", async () => {
    const endsAt = new Date(now.getTime() - 3_600_000);
    const vote = await insertVote("PENDING", endsAt);
    const db = (await getTestDatabase()) as unknown as DrizzleClient;
    await rejectWarDeclaration(db, vote, "expired", "PENDING");
    expect((await stored()).vote?.endsAt).toEqual(endsAt);
  });

  it("tells the initiator nothing when another writer settled the motion", async () => {
    const vote = await insertVote("APPROVED", now);
    const db = (await getTestDatabase()) as unknown as DrizzleClient;
    await rejectWarDeclaration(db, vote, "late", "PENDING");
    const result = await stored();
    expect(result.vote?.status).toBe("APPROVED");
    expect(result.notices).toEqual([]);
    expect(result.unread).toBe(0);
  });

  it("cancels a claimed motion when a village entered a war", async () => {
    const vote = await insertVote("APPROVED", now);
    const db = (await getTestDatabase()) as unknown as DrizzleClient;
    const activeWars = [
      {
        attackerVillageId: "defender",
        defenderVillageId: "third",
        type: "VILLAGE_WAR",
        warAllies: [],
      },
    ] as unknown as FetchActiveWarsReturnType[];
    const result = await startClaimedWarDeclaration(db, vote, {
      attackerVillage: { name: "Attacker" },
      defenderVillage: { name: "Defender", kageId: null },
      activeWars,
    });
    expect(result).toBe("VILLAGE_IN_WAR");
    const settled = await stored();
    expect(settled.vote?.status).toBe("REJECTED");
    expect(settled.notices.map((row) => row.content)).toEqual([
      "War declaration against Defender was cancelled — a village is already involved in an active war.",
    ]);
  });

  it("names a missing attacker as the reason", async () => {
    const vote = await insertVote("APPROVED", now);
    const db = (await getTestDatabase()) as unknown as DrizzleClient;
    const result = await startClaimedWarDeclaration(db, vote, {
      attackerVillage: undefined,
      defenderVillage: undefined,
      activeWars: [],
    });
    expect(result).toBe("ATTACKER_MISSING");
    const settled = await stored();
    expect(settled.vote?.status).toBe("REJECTED");
    expect(settled.notices.map((row) => row.content)).toEqual([
      "War declaration against another village was cancelled — the attacking village no longer exists.",
    ]);
  });
});
