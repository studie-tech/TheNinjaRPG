import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { beforeEach, afterEach, expect, it, vi } from "bun:test";
import { eq, and } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  conversation,
  quest,
  questHistory,
  questParty,
  user2conversation,
  userData,
  userItem,
  item,
  village,
  villageStructure,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { profileRouter } from "@/server/api/routers/profile";
import { questPartyRouter } from "@/server/api/routers/questParty";
import { questsRouter } from "@/server/api/routers/quests";
import { AllObjectives } from "@/validators/objectives";
import {
  insertItems,
  insertUsers,
  insertUserItems,
  insertDefaultAiProfile,
} from "../../../../setup/factories";
import {
  formQuestTeam,
  insertQuestTeamWorld,
  insertTeamQuest,
} from "../../../../setup/questParty";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { beforeStatements } from "../../../../setup/statements";

describeWithDatabase("quest team snapshots during unrelated battle", () => {
  beforeEach(async () => {
    await resetTables(
      aiProfile,
      battle,
      battleHistory,
      conversation,
      quest,
      questHistory,
      questParty,
      user2conversation,
      userData,
      userItem,
      item,
      village,
      villageStructure,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport({ answerOtherRequests: true });
    await insertQuestTeamWorld();
    await insertUsers([
      {
        userId: "enemy",
        username: "enemy",
        isAi: true,
        inArena: true,
        level: 50,
        rank: "JONIN",
      },
    ]);
    await insertDefaultAiProfile({ userId: "enemy" });
    await insertItems([{ id: "scroll" }]);
    await insertTeamQuest(
      [
        AllObjectives.parse({
          id: "collect",
          task: "collect_item",
          collectItemIds: ["scroll"],
          item_name: "Scroll",
          sector: 50,
          longitude: 11,
          latitude: 10,
          sectorType: "specific",
          locationType: "specific",
          nextObjectiveId: "wait",
        }),
        AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
      ],
      { consecutiveObjectives: true, maxAttempts: 3, maxCompletes: 3 },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  for (const task of ["collect_item", "deliver_item"] as const) {
    for (const timing of ["before battle", "during battle", "after battle"] as const) {
      it(`applies ${task} once when reconciled ${timing}`, async () => {
        const { client, advance, profile, items } = await teamFixture(task);
        if (timing === "before battle") {
          await advance();
          await profile.getUser();
        }
        expect(
          (
            await initiateBattle(
              { client, userIds: ["helper"], targetIds: ["enemy"] },
              "ARENA",
            )
          ).success,
        ).toBe(true);
        if (timing !== "before battle") await advance();
        if (timing === "during battle") {
          await profile.getUser();
          expect(await items()).toHaveLength(task === "collect_item" ? 0 : 2);
          expect(
            (await member(client, "helper"))?.questData?.[0]?.goals[0]
              ?.partyEffectsApplied,
          ).toBe(false);
        }
        await settleBattle(client, "helper");
        await expectReceipt(client, profile, items);
      });
    }

    it(`rejects a preloaded battle after an awake ${task} receipt commits`, async () => {
      const { client, advance, profile, items } = await teamFixture(task);
      let reconciled = false;
      const paused = beforeUserWrite(
        client,
        (set) => set.status === "BATTLE",
        async () => {
          await advance();
          await profile.getUser();
          reconciled = true;
        },
      );
      const started = await initiateBattle(
        { client: paused, userIds: ["helper"], targetIds: ["enemy"] },
        "ARENA",
      );
      expect(reconciled).toBe(true);
      expect(started.success).toBe(false);
      expect(await client.query.battle.findFirst()).toBeUndefined();
      expect((await member(client, "helper"))?.status).toBe("AWAKE");
      await expectReceipt(client, profile, items);
      expect(
        (
          await initiateBattle(
            { client, userIds: ["helper"], targetIds: ["enemy"] },
            "ARENA",
          )
        ).success,
      ).toBe(true);
      await settleBattle(client, "helper");
      await expectReceipt(client, profile, items);
    });

    it(`defers an awake ${task} receipt if combat wins its personal claim`, async () => {
      const { client, advance, profile, items } = await teamFixture(task);
      await advance();
      let started = false;
      const paused = beforeUserWrite(
        client,
        (set) =>
          !!set.questData &&
          !set.status &&
          (set.questData as { goals: { partyEffectsApplied?: boolean }[] }[]).some(
            (tracker) => tracker.goals.some((goal) => goal.partyEffectsApplied),
          ),
        async () => {
          expect(
            (
              await initiateBattle(
                { client, userIds: ["helper"], targetIds: ["enemy"] },
                "ARENA",
              )
            ).success,
          ).toBe(true);
          started = true;
        },
      );
      await callerForDatabase(profileRouter, "helper", paused).getUser();
      expect(started).toBe(true);
      expect(await items()).toHaveLength(task === "collect_item" ? 0 : 2);
      await settleBattle(client, "helper");
      await expectReceipt(client, profile, items);
    });

    for (const timing of ["during battle", "after preload"] as const) {
      it(`preserves an inherited ${task} receipt when reconciled ${timing}`, async () => {
        const { client, advance, profile, items, party } = await teamFixture(task);
        await advance();
        expect(
          (
            await (
              await callerFor(questPartyRouter, "helper")
            ).leave({ partyId: party.id })
          ).success,
        ).toBe(true);
        const paused = beforeUserWrite(
          client,
          (set) => set.status === "BATTLE",
          async () => {
            if (timing === "after preload") await profile.getUser();
          },
        );
        const started = await initiateBattle(
          { client: paused, userIds: ["helper"], targetIds: ["enemy"] },
          "ARENA",
        );
        expect(started.success).toBe(timing !== "after preload");
        if (started.success) {
          await profile.getUser();
          expect(await items()).toHaveLength(task === "collect_item" ? 0 : 2);
          await settleBattle(client, "helper");
        } else {
          expect(await client.query.battle.findFirst()).toBeUndefined();
          expect((await member(client, "helper"))?.status).toBe("AWAKE");
        }
        await expectReceipt(client, profile, items);
        expect((await member(client, "helper"))?.questData?.[0]?.party).toBeUndefined();
      });
    }
  }

  for (const mode of ["leave", "disband helper", "disband leader"] as const) {
    for (const readDuring of [false, true]) {
      it(`retains canonical progress when ${mode} waits for combat (profile ${readDuring})`, async () => {
        const fixture = await teamFixture("collect_item");
        const { client, advance, party } = fixture;
        const fighter = mode === "disband leader" ? "leader" : "helper";
        const profile = await callerFor(profileRouter, fighter);
        const items = () =>
          client.query.userItem.findMany({ where: eq(userItem.userId, fighter) });
        expect(
          (
            await initiateBattle(
              { client, userIds: [fighter], targetIds: ["enemy"] },
              "ARENA",
            )
          ).success,
        ).toBe(true);
        // Progress another member can contribute while this fighter owns a combat snapshot.
        if (fighter === "leader") {
          await client
            .update(userData)
            .set({ longitude: 11 })
            .where(eq(userData.userId, "helper"));
          expect(
            (await (await callerFor(questsRouter, "helper")).checkLocationQuest())
              .success,
          ).toBe(true);
        } else await advance();
        const actor = await callerFor(
          questPartyRouter,
          mode === "leave" ? "helper" : "leader",
        );
        const depart = () =>
          mode === "leave"
            ? actor.leave({ partyId: party.id })
            : actor.disband({ partyId: party.id });
        if (readDuring) await profile.getUser();
        const rejected = await depart();
        expect(rejected.success).toBe(false);
        expect(rejected.message).toContain("battle");
        expect((await member(client, fighter))?.questPartyId).toBe(party.id);
        expect(
          (await client.query.questParty.findFirst())?.tracker.goals[0]?.done,
        ).toBe(true);
        expect(await items()).toHaveLength(0);
        await settleBattle(client, fighter);
        expect((await depart()).success).toBe(true);
        expect((await member(client, fighter))?.questPartyId).toBeNull();
        await expectReceipt(client, profile, items, fighter);
        expect((await member(client, fighter))?.questData?.[0]?.party).toBeUndefined();
      });
    }

    it(`rejects a preloaded battle after ${mode} commits solo continuation`, async () => {
      const { client, advance, party } = await teamFixture("collect_item");
      await advance();
      const fighter = mode === "disband leader" ? "leader" : "helper";
      const actor = await callerFor(
        questPartyRouter,
        mode === "leave" ? "helper" : "leader",
      );
      let detached = false;
      const paused = beforeUserWrite(
        client,
        (set) => set.status === "BATTLE",
        async () => {
          expect(
            (
              await (mode === "leave"
                ? actor.leave({ partyId: party.id })
                : actor.disband({ partyId: party.id }))
            ).success,
          ).toBe(true);
          detached = true;
        },
      );
      const result = await initiateBattle(
        { client: paused, userIds: [fighter], targetIds: ["enemy"] },
        "ARENA",
      );
      expect(detached).toBe(true);
      expect(result.success).toBe(false);
      expect((await member(client, fighter))?.status).toBe("AWAKE");
      const profile = await callerFor(profileRouter, fighter);
      const items = () =>
        client.query.userItem.findMany({ where: eq(userItem.userId, fighter) });
      await expectReceipt(client, profile, items, fighter);
      expect(
        (
          await initiateBattle(
            { client, userIds: [fighter], targetIds: ["enemy"] },
            "ARENA",
          )
        ).success,
      ).toBe(true);
      await settleBattle(client, fighter);
      await expectReceipt(client, profile, items, fighter);
      expect((await member(client, fighter))?.questData?.[0]?.party).toBeUndefined();
    });
  }

  it("retains a departing member's canonical progress if combat starts before its personal detach", async () => {
    const { client, advance, party } = await teamFixture("collect_item");
    await advance();
    let started = false;
    const paused = beforeUserWrite(
      client,
      (set) => set.questPartyId === null && !!set.questData,
      async () => {
        expect(
          (
            await initiateBattle(
              { client, userIds: ["helper"], targetIds: ["enemy"] },
              "ARENA",
            )
          ).success,
        ).toBe(true);
        started = true;
      },
    );
    const helper = callerForDatabase(questPartyRouter, "helper", paused);
    const result = await helper.leave({ partyId: party.id });
    expect(started).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("battle");
    expect((await member(client, "helper"))?.questPartyId).toBe(party.id);
    expect((await client.query.questParty.findFirst())?.tracker.goals[0]?.done).toBe(
      true,
    );
    const leader = await callerFor(questPartyRouter, "leader");
    // Roster removal committed first, but the attached fighter still needs canonical recovery.
    expect((await leader.disband({ partyId: party.id })).success).toBe(false);
    expect(await client.query.questParty.findFirst()).toBeDefined();
    await settleBattle(client, "helper");
    expect((await helper.leave({ partyId: party.id })).success).toBe(true);
    const profile = await callerFor(profileRouter, "helper");
    const items = () =>
      client.query.userItem.findMany({ where: eq(userItem.userId, "helper") });
    await expectReceipt(client, profile, items);
    expect((await member(client, "helper"))?.questData?.[0]?.party).toBeUndefined();
  });

  for (const fighter of ["leader", "helper"]) {
    it(`retains every member's progress if ${fighter} enters combat during disband`, async () => {
      const { client, advance, party } = await teamFixture("collect_item");
      await advance();
      let started = false;
      const paused = beforeUserWrite(
        client,
        (set) =>
          set.questPartyId === null &&
          (
            set.questData as
              | { goals: { partyEffectsApplied?: boolean }[] }[]
              | undefined
          )?.[0]?.goals[0]?.partyEffectsApplied ===
            (fighter === "leader"),
        async () => {
          expect(
            (
              await initiateBattle(
                { client, userIds: [fighter], targetIds: ["enemy"] },
                "ARENA",
              )
            ).success,
          ).toBe(true);
          started = true;
        },
      );
      expect(
        (
          await callerForDatabase(questPartyRouter, "leader", paused).disband({
            partyId: party.id,
          })
        ).success,
      ).toBe(false);
      expect(started).toBe(true);
      expect((await member(client, fighter))?.questPartyId).toBe(party.id);
      expect((await client.query.questParty.findFirst())?.tracker.goals[0]?.done).toBe(
        true,
      );
      await settleBattle(client, fighter);
      for (const userId of ["leader", "helper"]) {
        if ((await member(client, userId))?.questPartyId)
          expect(
            (
              await (
                await callerFor(questPartyRouter, userId)
              ).leave({ partyId: party.id })
            ).success,
          ).toBe(true);
        const profile = await callerFor(profileRouter, userId);
        const items = () =>
          client.query.userItem.findMany({ where: eq(userItem.userId, userId) });
        await expectReceipt(client, profile, items, userId);
        expect((await member(client, userId))?.questData?.[0]?.party).toBeUndefined();
      }
      expect(await client.query.questParty.findFirst()).toBeUndefined();
    });
  }

  for (const task of ["collect_item", "deliver_item"] as const) {
    it(`preserves ordinary solo ${task} effects through combat`, async () => {
      const { client, party } = await teamFixture(task);
      expect(
        (
          await (
            await callerFor(questPartyRouter, "leader")
          ).disband({ partyId: party.id })
        ).success,
      ).toBe(true);
      // An ordinary solo attempt has no inherited team receipt markers.
      const personal = (await member(client, "helper"))!;
      for (const tracker of personal.questData ?? [])
        for (const goal of tracker.goals) delete goal.partyEffectsApplied;
      await client
        .update(userData)
        .set({ questData: personal.questData, longitude: 11 })
        .where(eq(userData.userId, "helper"));
      expect(
        (await (await callerFor(questsRouter, "helper")).checkLocationQuest()).success,
      ).toBe(true);
      const items = () =>
        client.query.userItem.findMany({ where: eq(userItem.userId, "helper") });
      expect(await items()).toHaveLength(1);
      expect(
        (
          await initiateBattle(
            { client, userIds: ["helper"], targetIds: ["enemy"] },
            "ARENA",
          )
        ).success,
      ).toBe(true);
      await settleBattle(client, "helper");
      await (await callerFor(profileRouter, "helper")).getUser();
      expect(await items()).toHaveLength(1);
      expect((await member(client, "helper"))?.questData?.[0]?.goals[0]).toMatchObject({
        done: true,
      });
    });
  }
});

const teamFixture = async (task: "collect_item" | "deliver_item") => {
  const client = await getTestDatabase();
  if (task === "deliver_item") {
    const definition = (await client.query.quest.findFirst())!;
    definition.content.objectives[0] = AllObjectives.parse({
      id: "collect",
      task,
      deliverItemIds: ["scroll"],
      item_name: "Scroll",
      sector: 50,
      longitude: 11,
      latitude: 10,
      sectorType: "specific",
      locationType: "specific",
      nextObjectiveId: "wait",
    });
    await client
      .update(quest)
      .set({ content: definition.content })
      .where(eq(quest.id, definition.id));
    await insertUserItems([
      { id: "leader-copy", userId: "leader", itemId: "scroll" },
      { id: "helper-copy-1", userId: "helper", itemId: "scroll" },
      { id: "helper-copy-2", userId: "helper", itemId: "scroll" },
    ]);
  }
  const { leader, party } = await formQuestTeam();
  const advance = async () => {
    await client
      .update(userData)
      .set({ longitude: 11 })
      .where(eq(userData.userId, "leader"));
    expect(
      (await (await callerFor(questsRouter, "leader")).checkLocationQuest()).success,
    ).toBe(true);
    expect((await client.query.questParty.findFirst())?.tracker.goals[0]?.done).toBe(
      true,
    );
  };
  return {
    client,
    party,
    advance,
    profile: await callerFor(profileRouter, "helper"),
    items: () =>
      client.query.userItem.findMany({
        where: and(eq(userItem.userId, "helper"), eq(userItem.itemId, "scroll")),
      }),
  };
};

const member = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({ where: eq(userData.userId, userId) });

const settleBattle = async (client: DrizzleClient, userId: string) => {
  const fight = (await client.query.battle.findFirst())!;
  fight.usersState
    .filter((user) => user.isAi && !user.isSummon)
    .forEach((user) => {
      user.curHealth = 0;
    });
  await client
    .update(battle)
    .set({ usersState: fight.usersState })
    .where(eq(battle.id, fight.id));
  const result = await (await callerFor(combatRouter, userId)).getBattle({
    battleId: fight.id,
  });
  expect(result.result?.outcome).toBe("Won");
};

const expectReceipt = async (
  client: DrizzleClient,
  profile: ReturnType<typeof profileRouter.createCaller>,
  items: () => Promise<unknown[]>,
  userId = "helper",
) => {
  await profile.getUser();
  expect(await items()).toHaveLength(1);
  expect(
    (await member(client, userId))?.questData?.find(
      (tracker) => tracker.id === "team-quest",
    )?.goals[0],
  ).toMatchObject({ done: true, partyEffectsApplied: true });
  await profile.getUser();
  expect(await items()).toHaveLength(1);
};

/** Pause the actual write, after its snapshot was read; all other router work uses real SQL. */
const beforeUserWrite = (
  client: DrizzleClient,
  matches: (set: Record<string, unknown>) => boolean,
  run: () => Promise<void>,
) => beforeStatements(client, userData, [run], { when: matches });
