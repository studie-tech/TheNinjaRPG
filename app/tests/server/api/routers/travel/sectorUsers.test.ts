import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { CREATOR_TRIAL_FIRST_FORM, CREATOR_USERNAME } from "@/drizzle/constants";
import {
  aiSpriteAnimation,
  anbuSquad,
  battle,
  overworldAiPlacement,
  quest,
  questHistory,
  sector,
  spriteAnimation,
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
      userData,
      anbuSquad,
      battle,
      village,
      sector,
      war,
      overworldAiPlacement,
      questHistory,
      quest,
      spriteAnimation,
      aiSpriteAnimation,
    );
    await (await getTestDatabase()).insert(anbuSquad).values({
      ...SQUAD,
      kageOrderId: "kage-order",
      leaderOrderId: "leader-order",
    });
    await insertUsers([
      {
        userId: VIEWER,
        username: "Viewer",
        status: "AWAKE",
        sector: SECTOR,
        villageId: SQUAD.villageId,
        anbuId: SQUAD.id,
      },
      { userId: "active", username: "Active", status: "AWAKE", sector: SECTOR },
      { userId: "banned", status: "AWAKE", sector: SECTOR, isBanned: true },
      { userId: "idle", status: "AWAKE", sector: SECTOR, updatedAt: new Date(0) },
      { userId: "ai", status: "AWAKE", sector: SECTOR, isAi: true },
      { userId: "asleep", status: "ASLEEP", sector: SECTOR },
      { userId: "elsewhere", status: "AWAKE", sector: SECTOR + 1 },
      {
        userId: "stealthed",
        status: "AWAKE",
        sector: SECTOR,
        stealthActive: true,
        stealthActivatedAt: new Date(),
        stealth: 100,
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
    expect(Object.keys(self).sort()).toEqual(
      [
        "userId",
        "username",
        "longitude",
        "latitude",
        "location",
        "curHealth",
        "maxHealth",
        "sector",
        "status",
        "avatar",
        "avatarLight",
        "level",
        "experience",
        "rank",
        "isOutlaw",
        "isBanned",
        "immunityUntil",
        "robImmunityUntil",
        "updatedAt",
        "villageId",
        "battleId",
        "anbuId",
        "stealthActive",
        "stealthActivatedAt",
        "stealth",
        "anbuSquad",
        "warRelationship",
        "isMasked",
        "spriteAppearance",
      ].sort(),
    );
    expect(self.anbuSquad).toEqual(SQUAD);
    // The caller's relation is correlated into its existing read, not fetched separately; the
    // published map that anchors roaming NPC copies is read alongside the window.
    expect(statements).toHaveLength(8);
  });

  it.each(["banned", "idle", "banned-and-idle"])(
    "keeps the caller visible when %s while excluding other banned/idle players",
    async (state) => {
      await (await getTestDatabase())
        .update(userData)
        .set({
          isBanned: state !== "idle",
          updatedAt: state !== "banned" ? new Date(0) : new Date(),
          stealthActive: true,
          stealthActivatedAt: new Date(),
          stealth: 100,
        })
        .where(eq(userData.userId, VIEWER));
      const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
        sector: SECTOR,
      });
      expect(result.users.map((u) => u.userId).sort()).toEqual(
        ["active", VIEWER].sort(),
      );
      expect(result.users.find((u) => u.userId === VIEWER)?.username).toBe("Viewer");
    },
  );

  it("draws the creator as their trial's opening form, for everyone and themselves", async () => {
    await insertUsers([
      {
        userId: "creator",
        username: CREATOR_USERNAME,
        status: "AWAKE",
        sector: SECTOR,
      },
      {
        userId: CREATOR_TRIAL_FIRST_FORM,
        isAi: true,
        avatar: "https://example.com/robot.webp",
      },
    ]);
    const db = await getTestDatabase();
    await db.insert(spriteAnimation).values(
      ["idle", "move", "strike"].map((id) => ({
        id,
        name: id,
        url: `https://example.com/${id}.png`,
        columns: 8,
        rows: 3,
        frameCount: 24,
        fps: 12.5,
        facing: "left" as const,
        createdByUserId: "editor",
      })),
    );
    await db.insert(aiSpriteAnimation).values([
      { userId: CREATOR_TRIAL_FIRST_FORM, actionKey: "idle", animationId: "idle" },
      { userId: CREATOR_TRIAL_FIRST_FORM, actionKey: "move", animationId: "move" },
      {
        userId: CREATOR_TRIAL_FIRST_FORM,
        actionKey: "basic:basicAttack",
        animationId: "strike",
      },
    ]);
    for (const callerId of [VIEWER, "creator"]) {
      const result = await (await callerFor(travelRouter, callerId)).getSectorData({
        sector: SECTOR,
      });
      expect(result.users.find((u) => u.userId === "creator")).toMatchObject({
        bodyArt: "https://example.com/robot.webp",
        bodyIdle: { id: "idle", url: "https://example.com/idle.png", frameCount: 24 },
        bodyMove: { id: "move", url: "https://example.com/move.png", facing: "left" },
      });
      expect(result.users.find((u) => u.userId === "active")).not.toHaveProperty(
        "bodyArt",
      );
    }
  });

  it.each(["TRAVEL", "QUEUED"] as const)(
    "does not append a %s caller",
    async (status) => {
      await (await getTestDatabase())
        .update(userData)
        .set({ status })
        .where(eq(userData.userId, VIEWER));
      const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
        sector: SECTOR,
      });
      expect(result.users.map((u) => u.userId)).toEqual(["active"]);
    },
  );

  it("still masks enemy ANBU members after merging the caller", async () => {
    await (await getTestDatabase())
      .update(userData)
      .set({ anbuId: SQUAD.id })
      .where(eq(userData.userId, "active"));
    await (await getTestDatabase())
      .update(userData)
      .set({ villageId: "other-village" })
      .where(eq(userData.userId, VIEWER));
    const result = await (await callerFor(travelRouter, VIEWER)).getSectorData({
      sector: SECTOR,
    });
    expect(result.users.find((u) => u.userId === "active")).toMatchObject({
      username: "ANBU Member",
      avatar: SQUAD.image,
      avatarLight: SQUAD.image,
    });
    // The same masking rule also applies to the appended caller's squad relation.
    expect(result.users.find((u) => u.userId === VIEWER)).toMatchObject({
      username: "ANBU Member",
      avatar: SQUAD.image,
      avatarLight: SQUAD.image,
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
