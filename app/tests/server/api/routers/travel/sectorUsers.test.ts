import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  anbuSquad,
  battle,
  overworldAiPlacement,
  quest,
  questHistory,
  sector,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import { travelRouter } from "@/server/api/routers/travel";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const SECTOR = 42;
const VIEWER = "sector-viewer";
const SQUAD = {
  id: "viewer-squad",
  name: "Viewer squad",
  image: "/squad.png",
  villageId: "viewer-village",
};

describeWithDatabase("travel.getSectorData player visibility", () => {
  beforeEach(async () => {
    await resetTables(
      userData, anbuSquad, battle, village, sector, war,
      overworldAiPlacement, questHistory, quest,
    );
    await (await getTestDatabase()).insert(anbuSquad).values({
      ...SQUAD,
      kageOrderId: "kage-order",
      leaderOrderId: "leader-order",
    });
    await insertUsers([
      {
        userId: VIEWER, username: "Viewer", status: "AWAKE", sector: SECTOR,
        villageId: SQUAD.villageId, anbuId: SQUAD.id,
      },
      { userId: "active", username: "Active", status: "AWAKE", sector: SECTOR },
      { userId: "banned", status: "AWAKE", sector: SECTOR, isBanned: true },
      { userId: "idle", status: "AWAKE", sector: SECTOR, updatedAt: new Date(0) },
      { userId: "ai", status: "AWAKE", sector: SECTOR, isAi: true },
      { userId: "asleep", status: "ASLEEP", sector: SECTOR },
      { userId: "elsewhere", status: "AWAKE", sector: SECTOR + 1 },
      {
        userId: "stealthed", status: "AWAKE", sector: SECTOR,
        stealthActive: true, stealthActivatedAt: new Date(), stealth: 100,
      },
    ]);
  });

  it("returns the caller exactly once with the same public fields as other players", async () => {
    const api = await callerFor(travelRouter, VIEWER);
    const { result, statements } = await recordQueries(() =>
      api.getSectorData({ sector: SECTOR }),
    );
    expect(result.users.map((u) => u.userId).sort()).toEqual(["active", VIEWER].sort());
    const self = result.users.find((u) => u.userId === VIEWER)!;
    const other = result.users.find((u) => u.userId === "active")!;
    expect(Object.keys(self).sort()).toEqual(Object.keys(other).sort());
    expect(Object.keys(self).sort()).toEqual([
      "userId", "username", "longitude", "latitude", "location", "curHealth",
      "maxHealth", "sector", "status", "avatar", "avatarLight", "level",
      "experience", "rank", "isOutlaw", "isBanned", "immunityUntil",
      "robImmunityUntil", "updatedAt", "villageId", "battleId", "anbuId",
      "stealthActive", "stealthActivatedAt", "stealth", "anbuSquad",
      "warRelationship", "isMasked", "spriteAppearance",
    ].sort());
    expect(self.anbuSquad).toEqual(SQUAD);
    // The caller's relation is correlated into its existing read, not fetched separately.
    expect(statements).toHaveLength(7);
  });

  it.each(["banned", "idle", "banned-and-idle"])(
    "keeps the caller visible when %s while excluding other banned/idle players",
    async (state) => {
      await (await getTestDatabase()).update(userData).set({
        isBanned: state !== "idle",
        updatedAt: state !== "banned" ? new Date(0) : new Date(),
        stealthActive: true,
        stealthActivatedAt: new Date(),
        stealth: 100,
      }).where(eq(userData.userId, VIEWER));
      const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({ sector: SECTOR });
      expect(result.users.map((u) => u.userId).sort()).toEqual(["active", VIEWER].sort());
      expect(result.users.find((u) => u.userId === VIEWER)?.username).toBe("Viewer");
    },
  );

  it.each(["TRAVEL", "QUEUED"] as const)("does not append a %s caller", async (status) => {
    await (await getTestDatabase()).update(userData).set({ status }).where(eq(userData.userId, VIEWER));
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({ sector: SECTOR });
    expect(result.users.map((u) => u.userId)).toEqual(["active"]);
  });

  it("still masks enemy ANBU members after merging the caller", async () => {
    await (await getTestDatabase()).update(userData).set({ anbuId: SQUAD.id }).where(eq(userData.userId, "active"));
    await (await getTestDatabase()).update(userData).set({ villageId: "other-village" }).where(eq(userData.userId, VIEWER));
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({ sector: SECTOR });
    expect(result.users.find((u) => u.userId === "active")).toMatchObject({
      username: "ANBU Member", avatar: SQUAD.image, avatarLight: SQUAD.image,
    });
    // The same masking rule also applies to the appended caller's squad relation.
    expect(result.users.find((u) => u.userId === VIEWER)).toMatchObject({
      username: "ANBU Member", avatar: SQUAD.image, avatarLight: SQUAD.image,
    });
  });

  it("preserves the not-found response for an unregistered caller", async () => {
    const api = await callerFor(travelRouter, "missing-viewer");
    await expect(api.getSectorData({ sector: SECTOR })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "User not found: missing-viewer. Please complete registration.",
    });
  });
});
