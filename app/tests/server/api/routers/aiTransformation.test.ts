import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  actionLog,
  aiProfile,
  aiSpriteAnimation,
  aiTransformation,
  battle,
  spriteAnimation,
  userData,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { aiRouter } from "@/server/api/routers/ai";
import { initiateBattle } from "@/server/api/routers/combat";
import { deleteAiTransformationsFor } from "@/queries/ai";
import { insertDefaultAiProfile, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const EDITOR = "boss-editor";
const PLAYER = "boss-player";
const ARRIVAL = {
  announce: "RISEN",
  log: "It rises again!",
  tier: 2,
  color: 0x123456,
  glow: 0x654321,
};

const fight = async (
  battleType: "QUEST" | "ARENA" | "OVERWORLD" | "RAID",
  targetIds = ["boss-one"],
  extra = {},
) =>
  initiateBattle(
    {
      userIds: [PLAYER],
      targetIds,
      client: await getTestDatabase(),
      actionUserId: PLAYER,
      biome: "default",
      ...extra,
    },
    battleType,
  );
const save = async (aiId: string, nextAiId: string | null, userId = EDITOR) => {
  const caller = await callerFor(aiRouter, userId);
  return caller.updateTransformation({
    aiId,
    transformation: nextAiId ? { ...ARRIVAL, nextAiId } : null,
  });
};

describeWithDatabase("AI boss transformations", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      actionLog,
      aiProfile,
      aiSpriteAnimation,
      aiTransformation,
      battle,
      spriteAnimation,
      userData,
    );
    await insertDefaultAiProfile({ userId: "boss-one" });
    await insertUsers([
      { userId: EDITOR, username: EDITOR, role: "CONTENT-ADMIN" },
      {
        userId: PLAYER,
        username: PLAYER,
        level: 20,
        rank: "GENIN",
        villageId: "village",
      },
      ...["boss-one", "boss-two", "boss-three"].map((userId) => ({
        userId,
        username: userId,
        isAi: true,
        // Only the opening form is an arena AI; later forms belong to the boss alone.
        inArena: userId === "boss-one",
        level: 20,
        rank: "GENIN" as const,
      })),
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("saves a link, logs it and shows the whole boss from any of its forms", async () => {
    expect(await save("boss-one", "boss-two")).toMatchObject({ success: true });
    await save("boss-two", "boss-three");

    const caller = await callerFor(aiRouter, EDITOR);
    const fromMiddle = await caller.getBossFight({ aiId: "boss-two" });
    expect(fromMiddle.forms.map((form) => form.userId)).toEqual([
      "boss-one",
      "boss-two",
      "boss-three",
    ]);
    expect(fromMiddle.transformation?.nextAiId).toBe("boss-three");
    expect(fromMiddle.forms[1]).toMatchObject({
      announce: "RISEN",
      hasArrivalClip: false,
      hasIdle: false,
      jutsuCount: 0,
    });
    const client = await getTestDatabase();
    expect(
      (await client.query.actionLog.findMany()).map((row) => row.relatedId),
    ).toContain("boss-one");

    expect(await save("boss-one", null)).toMatchObject({ success: true });
    expect((await caller.getBossFight({ aiId: "boss-one" })).forms).toHaveLength(1);
  });

  it("refuses non-editors, human next forms, loops and self-links without saving", async () => {
    expect(await save("boss-one", "boss-two", PLAYER)).toMatchObject({
      success: false,
    });
    expect(await save("boss-one", PLAYER)).toMatchObject({
      success: false,
      message: "The next form must be an AI",
    });
    expect(await save("boss-one", "boss-one")).toMatchObject({ success: false });
    expect(await save(PLAYER, "boss-one")).toMatchObject({
      success: false,
      message: "AI not found",
    });
    await save("boss-one", "boss-two");
    expect(await save("boss-two", "boss-one")).toMatchObject({
      success: false,
      message: "These forms would transform in a loop",
    });
    expect(
      await (await getTestDatabase()).query.aiTransformation.findMany(),
    ).toHaveLength(1);
    await expect(
      (await callerFor(aiRouter, PLAYER)).getBossFight({ aiId: "boss-one" }),
    ).rejects.toThrow("Unauthorized");
  });

  it("turns a lone AI opponent into a boss in every supported battle type", async () => {
    await save("boss-one", "boss-two");
    await save("boss-two", "boss-three");
    const client = await getTestDatabase();
    for (const battleType of ["QUEST", "ARENA", "OVERWORLD"] as const) {
      expect(await fight(battleType)).toMatchObject({ success: true });
      const [created] = await client.query.battle.findMany();
      expect(
        created?.extraState.encounter?.pendingWaves.map(
          (wave) => wave.arrival?.announce,
        ),
      ).toEqual(["RISEN", "RISEN"]);
      await resetTables(battle);
      await client.update(userData).set({ status: "AWAKE", battleId: null });
    }
  });

  it("leaves other fights untouched", async () => {
    await save("boss-one", "boss-two");
    const client = await getTestDatabase();
    expect(await fight("QUEST", ["boss-one", "boss-three"])).toMatchObject({
      success: true,
    });
    expect(
      (await client.query.battle.findFirst())?.extraState.encounter,
    ).toBeUndefined();
  });

  it("reads boss links alongside the participants, so a fight without a boss pays no extra round trip", async () => {
    const client = await getTestDatabase();
    const trips = async (targetIds: string[]) => {
      const { result, roundTrips } = await recordQueries(() =>
        fight("QUEST", targetIds),
      );
      expect(result).toMatchObject({ success: true });
      await resetTables(battle);
      await client.update(userData).set({ status: "AWAKE", battleId: null });
      return roundTrips;
    };
    // A pack never reads the links; a lone enemy reads them in the same wave.
    expect(await trips(["boss-one"])).toBe(await trips(["boss-one", "boss-three"]));
  });

  it("drops links to and from a deleted AI", async () => {
    await save("boss-one", "boss-two");
    await save("boss-two", "boss-three");
    const client = await getTestDatabase();
    await deleteAiTransformationsFor(client, "boss-two");
    expect(await client.query.aiTransformation.findMany()).toEqual([]);
  });
});
