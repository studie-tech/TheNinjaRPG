import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  discordEventDelivery,
  gameSetting,
  quest,
  territoryWar,
  territoryWarScore,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import { discordEventKey } from "@/libs/discordEvents";
import { lockWithMinuteTimer } from "@/libs/gamesettings";
import { Pusher } from "@/libs/pusher";
import { prepareExclusiveRaidActivation } from "@/libs/raids";
import { updateQuestForUpdateWars } from "@/queries/combat";
import {
  claimDiscordEventDelivery,
  finishDiscordEventDelivery,
  initializeDiscordEventDeliveries,
  listDiscordEventReceipts,
  listDiscordRaids,
  listDiscordTerritoryWars,
} from "@/queries/discordEvents";
import { updateQuestForUpdate } from "@/queries/quests";
import { questsRouter } from "@/server/api/routers/quests";
import {
  discordEventConfig,
  discordEventPayload,
  syncDiscordEvents,
} from "@/server/utils/discord/events";
import { QuestValidator, RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { deferred } from "../../../setup/deferred";
import { restoreEnvAfterEach } from "../../../setup/env";
import { insertQuests, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const env = process.env as Record<string, string | undefined>;
restoreEnvAfterEach(
  "NODE_ENV",
  "DISCORD_EVENT_UPDATES",
  "DISCORD_RAIDS_ROLE_ID",
  "DISCORD_WARS_ROLE_ID",
  "DISCORD_TERRITORY_WARS_ROLE_ID",
);
const now = new Date("2026-10-29T12:00:00Z");
let posts: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
  env.DISCORD_EVENT_UPDATES = "https://discord.com/api/webhooks/123/fixture";
  env.DISCORD_RAIDS_ROLE_ID = "111";
  env.DISCORD_WARS_ROLE_ID = "222";
  env.DISCORD_TERRITORY_WARS_ROLE_ID = "333";
  posts = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response('{"id":"confirmed"}'));
});
afterEach(() => {
  vi.restoreAllMocks();
});
it("restricts mentions and caps Discord content length", () => {
  const payload = discordEventPayload("111", "@everyone <@&222> " + "x".repeat(2500));
  expect(payload.content.length).toBe(2000);
  expect(payload.allowed_mentions).toEqual({
    parse: [],
    roles: ["111"],
    users: [],
    replied_user: false,
  });
});
it("fails closed for missing roles, non-Discord URLs and non-HTTPS webhooks", () => {
  for (const url of [
    "",
    "https://discord.com.evil.test/api/webhooks/1/token",
    "http://discord.com/api/webhooks/1/token",
  ]) {
    env.DISCORD_EVENT_UPDATES = url;
    expect(discordEventConfig()).toBeNull();
  }
});
it("does no database/network work under the test runner", async () => {
  await syncDiscordEvents(null as never, now);
  expect(posts).not.toHaveBeenCalled();
});

describeWithDatabase("Discord event delivery receipts", () => {
  beforeEach(async () => {
    await resetTables(
      discordEventDelivery,
      gameSetting,
      quest,
      territoryWarScore,
      territoryWar,
      war,
      village,
      userData,
    );
  });
  const seed = async () => {
    const db = await getTestDatabase();
    await insertQuests([
      {
        id: "raid",
        name: "Boss",
        questType: "raid",
        createdAt: now,
        raidBossCurrentHealth: 100,
        raidEndsAt: new Date(now.getTime() + 600_000),
      },
    ]);
    env.NODE_ENV = "development";
    return db;
  };
  it("sends starts and ends once across repeat and concurrent ticks", async () => {
    const db = await seed();
    await Promise.all([syncDiscordEvents(db, now), syncDiscordEvents(db, now)]);
    expect(posts).toHaveBeenCalledTimes(1);
    await db.update(quest).set({ raidBossCurrentHealth: 0 });
    await Promise.all([
      syncDiscordEvents(db, new Date(now.getTime() + 60_000)),
      syncDiscordEvents(db, new Date(now.getTime() + 60_000)),
    ]);
    expect(posts).toHaveBeenCalledTimes(2);
    await syncDiscordEvents(db, new Date(now.getTime() + 120_000));
    expect(posts).toHaveBeenCalledTimes(2);
    expect(String(posts.mock.calls[0]![0])).toContain("wait=true");
    const payload = JSON.parse(String(posts.mock.calls[0]![1]?.body));
    expect(payload.allowed_mentions.roles).toEqual(["111"]);
  });
  it("retries rejected posts and stale leases without consuming delivery", async () => {
    const db = await seed();
    posts.mockResolvedValueOnce(new Response("limited", { status: 429 }));
    await syncDiscordEvents(db, now);
    await syncDiscordEvents(db, new Date(now.getTime() + 60_000));
    expect(posts).toHaveBeenCalledTimes(2);
    await syncDiscordEvents(db, new Date(now.getTime() + 660_000));
    expect(posts).toHaveBeenCalledTimes(3); // deadline ended; end is a separate alert
    const id = "raids:test-lease:start";
    await initializeDiscordEventDeliveries(
      db,
      [{ id, category: "raids", message: "Fixture" }],
      now,
    );
    expect((await claimDiscordEventDelivery(db, id, now, 120_000)).rowsAffected).toBe(
      1,
    );
    expect(
      (
        await claimDiscordEventDelivery(
          db,
          id,
          new Date(now.getTime() + 60_000),
          120_000,
        )
      ).rowsAffected,
    ).toBe(0);
    const later = new Date(now.getTime() + 180_000);
    expect((await claimDiscordEventDelivery(db, id, later, 120_000)).rowsAffected).toBe(
      1,
    );
    expect((await finishDiscordEventDelivery(db, id, now, true)).rowsAffected).toBe(0);
    expect((await finishDiscordEventDelivery(db, id, later, true)).rowsAffected).toBe(
      1,
    );
  });
  it("keeps an end behind a pending start across overlapping minute ticks", async () => {
    const db = await seed();
    setSystemTime(new Date("2026-10-29T12:00:55Z"));
    const { promise: blocked, resolve: release } = deferred<void>();
    const { promise: started, resolve: entered } = deferred<void>();
    const accepted: string[] = [];
    posts.mockImplementation(async (_url, options) => {
      const message = JSON.parse(String(options?.body)).content as string;
      if (message.includes("Raid started")) {
        entered();
        await blocked;
      }
      accepted.push(message.includes("Raid started") ? "start" : "end");
      return new Response('{"id":"confirmed"}');
    });
    const tick = async () => {
      expect(
        (await lockWithMinuteTimer(db, "territory-war-maintenance")).isNewMinute,
      ).toBe(true);
      await syncDiscordEvents(db);
    };
    const first = tick();
    try {
      await started;
      await db.update(quest).set({ raidBossCurrentHealth: 0 });
      setSystemTime(new Date("2026-10-29T12:01:00Z"));
      await tick();
      expect(accepted).toEqual([]);
      expect(posts).toHaveBeenCalledTimes(1);
      release();
      await first;
      setSystemTime(new Date("2026-10-29T12:02:00Z"));
      await tick();
      expect(accepted).toEqual(["start", "end"]);
      expect(
        (await db.query.discordEventDelivery.findMany()).every(
          (receipt) => receipt.delivered,
        ),
      ).toBe(true);
    } finally {
      release();
      await first;
      setSystemTime();
    }
  });
  it("retries a stale start lease before its queued end", async () => {
    setSystemTime(now);
    try {
      const db = await seed();
      await db.update(quest).set({ raidBossCurrentHealth: 0 });
      posts.mockResolvedValueOnce(new Response("limited", { status: 429 }));
      await syncDiscordEvents(db, now);
      const id = `${discordEventKey("raids", `raid:${now.getTime() + 600_000}`)}:start`;
      expect((await claimDiscordEventDelivery(db, id, now, 120_000)).rowsAffected).toBe(
        1,
      );
      await syncDiscordEvents(db, now);
      expect(posts).toHaveBeenCalledTimes(1);
      setSystemTime(new Date(now.getTime() + 180_000));
      await syncDiscordEvents(db);
      const phases = posts.mock.calls.map((call) =>
        JSON.parse(String(call[1]?.body)).content.includes("Raid started")
          ? "start"
          : "end",
      );
      expect(phases).toEqual(["start", "start", "end"]);
      expect(
        (await db.query.discordEventDelivery.findMany()).every(
          (receipt) => receipt.delivered,
        ),
      ).toBe(true);
    } finally {
      setSystemTime();
    }
  });
  it("announces restored open raids without treating content edits as activations", async () => {
    const db = await getTestDatabase();
    env.NODE_ENV = "development";
    await insertUsers([{ userId: "editor", role: "OWNER" }]);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const objective = RaidObjective.parse({
      id: "boss",
      task: "open_raid",
      sector: 42,
      opponentAIs: [{ ids: ["boss"], number: 1 }],
    });
    await insertQuests([
      {
        id: "open",
        name: "Open boss",
        questType: "raid",
        createdAt: now,
        raidBossMaxHealth: 100,
        raidBossCurrentHealth: 100,
        content: {
          objectives: [objective],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: ["character"],
        },
      },
    ]);
    const caller = await callerFor(questsRouter, "editor");
    const edit = async (patch: { name?: string; raidBossCurrentHealth?: number }) => {
      const row = (await db.query.quest.findFirst({ where: eq(quest.id, "open") }))!;
      const result = await caller.update({
        id: row.id,
        data: QuestValidator.parse({ ...row, ...patch }),
      });
      expect(result.success, result.message).toBe(true);
      return (await db.query.quest.findFirst({ where: eq(quest.id, "open") }))!;
    };
    await syncDiscordEvents(db, now);
    expect((await edit({ name: "Renamed boss" })).raidStartedAt).toBeNull();
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(1);
    await db
      .update(quest)
      .set({ raidBossCurrentHealth: 0 })
      .where(eq(quest.id, "open"));
    await syncDiscordEvents(db, now);
    expect((await edit({ name: "Resting boss" })).raidStartedAt).toBeNull();
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(2);
    const restored = await edit({ raidBossCurrentHealth: 100 });
    expect(restored.createdAt).toEqual(now);
    expect(restored.raidStartedAt).toEqual(restored.updatedAt);
    expect(await listDiscordRaids(db)).toHaveLength(1);
    const tick = new Date(Math.max(Date.now(), now.getTime()) + 60_000);
    await syncDiscordEvents(db, tick);
    expect(posts).toHaveBeenCalledTimes(3);
    expect((await edit({ name: "Active boss" })).raidStartedAt).toEqual(
      restored.raidStartedAt,
    );
    await syncDiscordEvents(db, tick);
    expect(posts).toHaveBeenCalledTimes(3);
    await db
      .update(quest)
      .set({ raidBossCurrentHealth: 0 })
      .where(eq(quest.id, "open"));
    await syncDiscordEvents(db, tick);
    await syncDiscordEvents(db, tick);
    expect(posts).toHaveBeenCalledTimes(4);
    // A defeat during the content save must not reuse a decision based on living HP.
    const stale = await edit({ raidBossCurrentHealth: 100 });
    await db
      .update(quest)
      .set({ raidBossCurrentHealth: 0 })
      .where(eq(quest.id, "open"));
    expect(
      (
        await updateQuestForUpdate(
          db,
          { data: QuestValidator.parse(stale) },
          new Date(stale.updatedAt.getTime() + 1),
          stale,
        )
      ).rowsAffected,
    ).toBe(0);
  });
  it("retries the immutable end message after an exclusive quest is reactivated", async () => {
    const db = await getTestDatabase();
    env.NODE_ENV = "development";
    const deadline = new Date(now.getTime() + 60_000);
    await insertQuests([
      {
        id: "exclusive",
        name: "First boss",
        questType: "raid",
        createdAt: now,
        raidBossMaxHealth: 100,
        raidBossCurrentHealth: 100,
        raidEndsAt: deadline,
        content: {
          objectives: [
            RaidObjective.parse({
              id: "boss",
              task: "exclusive_raid",
              sector: 42,
              opponentAIs: [{ ids: ["boss"], number: 1 }],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await syncDiscordEvents(db, now);
    await db
      .update(quest)
      .set({ raidBossCurrentHealth: 0 })
      .where(eq(quest.id, "exclusive"));
    posts.mockResolvedValueOnce(new Response("limited", { status: 429 }));
    await syncDiscordEvents(db, now);
    const oldEnd = `${discordEventKey("raids", `exclusive:${deadline.getTime()}`)}:end`;
    const receipt = () =>
      db.query.discordEventDelivery.findFirst({
        where: eq(discordEventDelivery.id, oldEnd),
      });
    expect((await receipt())?.delivered).toBe(false);
    const row = (await db.query.quest.findFirst({ where: eq(quest.id, "exclusive") }))!;
    const activation = prepareExclusiveRaidActivation([row], 42);
    expect(activation.activated).toBe(true);
    await updateQuestForUpdateWars(db, activation.mutations[0]!);
    await db
      .update(quest)
      .set({ name: "Second boss" })
      .where(eq(quest.id, "exclusive"));
    const tick = new Date(Math.max(Date.now(), now.getTime()));
    await Promise.all([syncDiscordEvents(db, tick), syncDiscordEvents(db, tick)]);
    await syncDiscordEvents(db, tick);
    expect((await receipt())?.delivered).toBe(true);
    const messages = posts.mock.calls.map(
      (call) => JSON.parse(String(call[1]?.body)).content as string,
    );
    expect(
      messages.filter((message) =>
        message.includes("Raid ended: **First boss**. The boss was defeated!"),
      ),
    ).toHaveLength(2); // rejected attempt and successful retry
    expect(
      messages.filter((message) => message.includes("Raid started: **Second boss**")),
    ).toHaveLength(1);
    expect(messages).toHaveLength(4);
  });
  it("stages messages beyond a failed post and the batch limit before game rows change", async () => {
    const db = await getTestDatabase();
    env.NODE_ENV = "development";
    await insertQuests(
      Array.from({ length: 21 }, (_, i) => ({
        id: `raid-${i}`,
        name: `Boss ${i}`,
        questType: "raid" as const,
        createdAt: now,
        raidBossCurrentHealth: 100,
      })),
    );
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(20);
    await db.update(quest).set({ hidden: true, name: "Changed" });
    posts.mockResolvedValueOnce(new Response("limited", { status: 429 }));
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(21);
    await Promise.all([syncDiscordEvents(db, now), syncDiscordEvents(db, now)]);
    expect(posts).toHaveBeenCalledTimes(22);
    expect(
      posts.mock.calls
        .map((call) => JSON.parse(String(call[1]?.body)).content as string)
        .every((message) => message.includes("Raid started: **Boss")),
    ).toBe(true);
    expect(
      (await db.query.discordEventDelivery.findMany()).every(
        (receipt) => receipt.delivered,
      ),
    ).toBe(true);
  });
  it("does not replay old delivered territory receipts while retaining pending ends", async () => {
    const db = await getTestDatabase();
    env.NODE_ENV = "development";
    const ended = new Date(now.getTime() - 2 * 86_400_000);
    const enabled = new Date(now.getTime() - 3 * 86_400_000);
    const id = discordEventKey("territory", "old");
    await db.insert(gameSetting).values({
      id: "discord-event:territory:enabled",
      name: "discord-event:territory:enabled",
      time: enabled,
      value: 1,
    });
    await db.insert(discordEventDelivery).values(
      ["start", "end"].map((phase) => ({
        id: `${id}:${phase}`,
        category: "territory" as const,
        message: `Territory War ${phase === "end" ? "ended" : "started"}`,
        createdAt: ended,
        delivered: true,
      })),
    );
    await db.insert(territoryWar).values({
      id: "old",
      predecessorId: "initial",
      guardianId: "guardian",
      sector: 42,
      startsAt: ended,
      endsAt: ended,
      resolvedAt: ended,
    });
    expect(await listDiscordEventReceipts(db, now)).toHaveLength(0);
    await syncDiscordEvents(db, now);
    await syncDiscordEvents(db, now);
    expect(posts).not.toHaveBeenCalled();
    await db
      .update(discordEventDelivery)
      .set({ delivered: false })
      .where(eq(discordEventDelivery.id, `${id}:end`));
    await syncDiscordEvents(db, now);
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(posts.mock.calls[0]![1]?.body)).content).toContain(
      "Territory War ended",
    );
  });
  it("announces war and faction raid results after their activation marker", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "a", name: "Akikaze", kageId: "chief", sector: 1 },
      { id: "b", name: "Hyorin", kageId: "other", sector: 2 },
    ]);
    await db.insert(gameSetting).values({
      id: "discord-event:wars:enabled",
      name: "discord-event:wars:enabled",
      time: new Date(now.getTime() - 60_000),
      value: 1,
    });
    await db.insert(war).values(
      ["VILLAGE_WAR", "WAR_RAID"].map((type) => ({
        id: type,
        type: type as "VILLAGE_WAR" | "WAR_RAID",
        attackerVillageId: "a",
        defenderVillageId: "b",
        startedAt: new Date(now.getTime() - 60_000),
        endedAt: now,
        status: "ATTACKER_VICTORY" as const,
      })),
    );
    env.NODE_ENV = "development";
    await syncDiscordEvents(db, now);
    expect(posts).toHaveBeenCalledTimes(4);
    const messages = posts.mock.calls.map(
      (call) => JSON.parse(String(call[1]?.body)).content as string,
    );
    expect(
      messages.filter((message) => message.includes("Winner: **Akikaze**")),
    ).toHaveLength(2);
  });
  it("reads territory resolution and tied winners in one statement", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values({
      id: "event",
      predecessorId: "initial",
      guardianId: "guardian",
      sector: 42,
      startsAt: now,
      endsAt: now,
      resolvedAt: now,
    });
    await db.insert(territoryWarScore).values(
      ["Akikaze", "Faction"].map((name) => ({
        warId: "event",
        competitorId: name,
        name,
        rewarded: true,
      })),
    );
    expect((await listDiscordTerritoryWars(db))[0]?.winners.sort()).toEqual([
      "Akikaze",
      "Faction",
    ]);
    expect(
      await db.query.gameSetting.findMany({ where: eq(gameSetting.value, 1) }),
    ).toHaveLength(0);
  });
});
