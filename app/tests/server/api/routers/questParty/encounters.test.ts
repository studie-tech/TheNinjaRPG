import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  conversation,
  jutsu,
  overworldAiPlacement,
  quest,
  questHistory,
  questParty,
  sectorMap,
  user2conversation,
  userData,
  userJutsu,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import { Pusher } from "@/libs/pusher";
import { rollObjectiveAttackers } from "@/libs/quest";
import { combatRouter } from "@/routers/combat";
import { fetchUpdatedUser } from "@/routers/profile";
import { questPartyRouter, startQuestPartyEncounter } from "@/routers/questParty";
import { travelRouter } from "@/routers/travel";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { getTagSchema } from "@/validators/combat";
import { AllObjectives } from "@/validators/objectives";
import {
  insertDefaultAiProfile,
  insertJutsus,
  insertUsers,
} from "../../../../setup/factories";
import {
  formQuestTeam,
  insertQuestTeamWorld,
  insertTeamQuest,
  questTeamMember,
} from "../../../../setup/questParty";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { aroundStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("quest team encounter location claims", () => {
  beforeEach(async () => {
    await resetTables(
      aiProfile,
      jutsu,
      overworldAiPlacement,
      userJutsu,
      battle,
      battleHistory,
      conversation,
      quest,
      questHistory,
      questParty,
      sectorMap,
      user2conversation,
      userData,
      village,
      villageStructure,
    );
    invalidatePublishedMapCache();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport();
    const client = await getTestDatabase();
    await client.insert(sectorMap).values({
      id: "walkable",
      sector: 50,
      name: "Walkable map",
      width: 26,
      height: 26,
      status: "PUBLISHED",
      version: 1,
      normalizedJson: {
        formatVersion: 1,
        sector: 50,
        name: "Walkable map",
        width: 26,
        height: 26,
        tiles: Array.from({ length: 26 * 26 }, (_, index) => ({
          x: index % 26,
          y: Math.floor(index / 26),
          terrain: "ground",
          walkCost: 1,
          blocked: false,
          zone: "wilderness",
          battleBiome: "ground",
        })),
        objects: [],
        anchors: [],
        exits: [],
        metadata: { importedAt: new Date().toISOString(), source: "tiled" },
      },
    });
    await insertQuestTeamWorld({
      longitude: 12,
      latitude: 13,
      // Stealth avoids Next's deferred map broadcast in direct callers; movement guards stay real.
      stealthActive: true,
      stealthActivatedAt: new Date(),
      stealth: 100,
    });
    await insertUsers([
      { userId: "enemy", username: "enemy", isAi: true, level: 10, rank: "GENIN" },
    ]);
    await insertDefaultAiProfile({ userId: "enemy" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    invalidatePublishedMapCache();
  });

  it("preloads authored starting pools and effects for every quest teammate", async () => {
    const client = await getTestDatabase();
    await insertTeamQuest(
      [
        AllObjectives.parse({
          id: "encounter",
          task: "start_battle",
          opponentAIs: [{ ids: ["enemy"], number: 1 }],
          givePools: 25,
          applyBuffs: [
            getTagSchema("shield").parse({ power: 100, health: 500, rounds: 3 }),
          ],
        }),
      ],
      { maxAttempts: 3 },
    );
    await insertJutsus(
      ["PVE", "BOTH", "PVP"].map((usage) => ({
        id: `jutsu-${usage}`,
        name: `Jutsu ${usage}`,
        battleUsageType: usage as "PVE" | "PVP" | "BOTH",
      })),
    );
    await client.insert(userJutsu).values(
      ["leader", "helper"].flatMap((userId) =>
        ["PVE", "BOTH", "PVP"].map((usage) => ({
          id: `${userId}-${usage}`,
          userId,
          jutsuId: `jutsu-${usage}`,
          equipped: true,
        })),
      ),
    );
    // A bloodline must not make general jutsu (null bloodlineId) disappear.
    await client
      .update(userData)
      .set({ bloodlineId: "player-bloodline" })
      .where(eq(userData.userId, "helper"));
    const { leader, party } = await formQuestTeam();
    expect((await leader.overview()).current).toMatchObject({
      hasEncounter: true,
      members: expect.arrayContaining([
        expect.objectContaining({ userId: "helper", longitude: 12, latitude: 13 }),
      ]),
    });
    expect((await leader.startEncounter({ partyId: party.id })).success).toBe(true);
    const fight = (await client.query.battle.findFirst())!;
    expect(fight.extraState.questBattleSource).toEqual({
      questId: "team-quest",
      objectiveId: "encounter",
    });
    for (const player of fight.usersState.filter(
      (entry) => !entry.isAi && !entry.isSummon,
    )) {
      const actions = availableUserActions(fight, player.userId);
      expect(actions.map((action) => action.id)).toEqual(
        expect.arrayContaining(["jutsu-PVE", "jutsu-BOTH"]),
      );
      expect(actions.map((action) => action.id)).not.toContain("jutsu-PVP");
      expect(
        (
          await (await callerFor(combatRouter, player.userId)).getBattleHistory({})
        ).data.some((entry) => entry.battleId === fight.id),
      ).toBe(true);
      expect(player.curHealth).toBe(player.maxHealth / 4);
      expect(player.curChakra).toBe(player.maxChakra / 4);
      expect(player.curStamina).toBe(player.maxStamina / 4);
      expect(fight.usersEffects).toContainEqual(
        expect.objectContaining({
          targetId: player.userId,
          type: "shield",
          power: 500,
          rounds: 3,
        }),
      );
    }
  });
  const encounterLocation = async () =>
    (await (await formQuestTeam()).leader.overview()).current?.encounterLocation;
  const defeat = (overrides: Record<string, unknown>) =>
    AllObjectives.parse({
      id: "encounter",
      task: "defeat_opponents",
      opponentAIs: [{ ids: ["enemy"], number: 1 }],
      sector: 50,
      longitude: 5,
      latitude: 6,
      ...overrides,
    });
  it("gathers generic battles at the leader", async () => {
    await insertTeamQuest(
      [
        AllObjectives.parse({
          id: "encounter",
          task: "start_battle",
          opponentAIs: [{ ids: ["enemy"], number: 1 }],
        }),
      ],
      { maxAttempts: 3 },
    );
    expect(await encounterLocation()).toEqual({
      sector: 50,
      longitude: 12,
      latitude: 13,
    });
  });
  it("shows an authored location unless hiding it applies to another sector", async () => {
    await insertTeamQuest([defeat({})], { maxAttempts: 3 });
    expect(await encounterLocation()).toEqual({
      sector: 50,
      longitude: 5,
      latitude: 6,
    });
  });
  it.each([
    [50, { sector: 50, longitude: 5, latitude: 6 }],
    [51, null],
  ])(
    "reveals a hidden objective in sector %i only to members standing there",
    async (sector, expected) => {
      await insertTeamQuest([defeat({ sector, hideLocation: true })], {
        maxAttempts: 3,
      });
      expect(await encounterLocation()).toEqual(expected);
    },
  );
  it.each([
    [true, { sector: 50, longitude: 7, latitude: 8 }],
    [false, null],
  ])(
    "uses the live tile of a bound NPC, never stale coordinates: active=%p",
    async (isActive, expected) => {
      const client = await getTestDatabase();
      await client.insert(overworldAiPlacement).values({
        id: "bound-npc",
        aiTemplateUserId: "enemy",
        interactionType: "HOSTILE",
        sectorList: [],
        sector: 50,
        longitude: 7,
        latitude: 8,
        positionVersion: 0,
        isActive,
      });
      await insertTeamQuest([defeat({ overworldPlacementId: "bound-npc" })], {
        maxAttempts: 3,
      });
      expect(await encounterLocation()).toEqual(expected);
    },
  );
  it("releases a settled team encounter when a member enters unrelated PvP", async () => {
    const client = await getTestDatabase();
    await insertTeamQuest(
      [AllObjectives.parse({ id: "goal", task: "stats_trained", value: 100 })],
      { maxAttempts: 3 },
    );
    const { leader, party } = await formQuestTeam();
    expect((await leader.overview()).current?.hasEncounter).toBe(false);
    // Settlement releases the users and deletes the battle before the next team sync.
    await client
      .update(questParty)
      .set({ battleId: "settled-team-battle" })
      .where(eq(questParty.id, party.id));
    await insertUsers([
      {
        userId: "outsider",
        username: "outsider",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        experience: 20_000_000,
        sector: 50,
        longitude: 12,
        latitude: 13,
        villageId: null,
      },
    ]);
    const attacked = await (await callerFor(combatRouter, "outsider")).attackUser({
      userId: "helper",
      sector: 50,
      longitude: 12,
      latitude: 13,
    });
    expect(attacked.success).toBe(true);
    expect(attacked.battleId).not.toBe("settled-team-battle");
    const updated = await fetchUpdatedUser({ client, userId: "leader" });
    expect(updated.user?.questParty?.battleId).toBeNull();
    expect((await client.query.questParty.findFirst())?.battleId).toBeNull();
    expect((await leader.leave({ partyId: party.id })).success).toBe(true);
    expect(
      (await client.query.userData.findFirst({ where: eq(userData.userId, "helper") }))
        ?.battleId,
    ).toBe(attacked.battleId);
  });

  it.each([false, true])(
    "retains the active battle reservation when publication fails (committed=%p)",
    async (committed) => {
      const client = await getTestDatabase();
      await insertTeamQuest(
        [
          AllObjectives.parse({
            id: "encounter",
            task: "start_battle",
            opponentAIs: [{ ids: ["enemy"], number: 1 }],
          }),
        ],
        { maxAttempts: 3 },
      );
      const { leader, party } = await formQuestTeam();
      const failing = aroundStatements(
        client,
        questParty,
        async (run) => {
          if (committed) await run();
          throw new Error("Publication unavailable");
        },
        {
          when: (set) =>
            typeof set.battleId === "string" && !set.battleId.startsWith("claiming:"),
        },
      );
      await expect(
        callerForDatabase(questPartyRouter, "leader", failing).startEncounter({
          partyId: party.id,
        }),
      ).rejects.toThrow("Publication unavailable");
      const [saved, fight, members] = await Promise.all([
        client.query.questParty.findFirst(),
        client.query.battle.findFirst(),
        client.query.userData.findMany(),
      ]);
      expect(fight).toBeDefined();
      if (committed) expect(saved?.battleId).toBe(fight!.id);
      else expect(saved?.battleId).toMatch(/^claiming:/);
      expect(
        members
          .filter((member) => member.questPartyId === party.id)
          .every(
            (member) => member.status === "BATTLE" && member.battleId === fight!.id,
          ),
      ).toBe(true);
      const refreshed = await fetchUpdatedUser({ client, userId: "leader" });
      expect(refreshed.user?.questParty?.battleId).toBe(fight!.id);
      expect((await client.query.questParty.findFirst())?.battleId).toBe(fight!.id);
      await insertUsers([
        questTeamMember("replacement", { longitude: 12, latitude: 13 }),
      ]);
      expect(
        (
          await (
            await callerFor(questPartyRouter, "replacement")
          ).join({ partyId: party.id })
        ).success,
      ).toBe(false);
    },
  );

  for (const battleType of ["QUEST", "RANDOM_ENCOUNTER"] as const) {
    for (const timing of [
      "co-located",
      "before lobby load",
      "before combat preload",
      "all before combat preload",
      "before participant claim",
    ] as const) {
      it(`${battleType} keeps the original launch tile (${timing})`, async () => {
        const client = await getTestDatabase();
        await insertTeamQuest(
          [
            AllObjectives.parse(
              battleType === "QUEST"
                ? {
                    id: "encounter",
                    task: "start_battle",
                    opponentAIs: [{ ids: ["enemy"], number: 1 }],
                  }
                : {
                    id: "encounter",
                    task: "win_encounter_at_location",
                    sector: 50,
                    attackers: [{ ids: ["enemy"], number: 100 }],
                  },
            ),
          ],
          { maxAttempts: 3 },
        );
        const { leader, party } = await formQuestTeam();
        const move = async (userId: string) => {
          const moved = await (await callerFor(travelRouter, userId)).moveInSector({
            curLongitude: 12,
            curLatitude: 13,
            longitude: 13,
            latitude: 13,
            sector: 50,
            villageId: "home",
            battleId: null,
            level: 50,
            avatar: "https://example.com/avatar.png",
            avatarLight: "https://example.com/avatar.png",
            username: userId,
          });
          expect(moved.success).toBe(true);
          expect(moved.data).toMatchObject({ longitude: 13, latitude: 13, sector: 50 });
        };
        if (timing === "before lobby load") await move("helper");
        const { user } = await fetchUpdatedUser({ client, userId: "leader" });
        let interposed = false;
        // Execute legal travel at a real SQL boundary without changing the production predicate.
        const interleaved = aroundStatements(
          aroundStatements(
            client,
            questParty,
            async (run) => {
              const result = (await run()) as { rowsAffected: number };
              expect(result.rowsAffected).toBe(1);
              await move("helper");
              if (timing === "all before combat preload") await move("leader");
              interposed = true;
              return result;
            },
            {
              when: (set) =>
                String(set.battleId).startsWith("claiming:") &&
                (timing === "before combat preload" ||
                  timing === "all before combat preload"),
            },
          ),
          userData,
          async (run) => {
            await move("helper");
            const result = await run();
            interposed = true;
            return result;
          },
          {
            when: (set) =>
              set.status === "BATTLE" && timing === "before participant claim",
          },
        );
        const ambush =
          battleType === "RANDOM_ENCOUNTER" && user?.questParty
            ? rollObjectiveAttackers(
                user.questParty.quest.content.objectives,
                50,
                () => 0,
                () => "team-quest",
              )
            : undefined;
        if (battleType === "RANDOM_ENCOUNTER")
          expect(ambush).toMatchObject({ type: "random_encounter", ids: ["enemy"] });
        const result = await startQuestPartyEncounter({
          client: interleaved,
          user,
          userId: "leader",
          partyId: party.id,
          ambush,
        });
        expect(result.success).toBe(timing === "co-located");
        expect(interposed).toBe(
          timing !== "co-located" && timing !== "before lobby load",
        );
        const [savedParty, humans, battles, histories] = await Promise.all([
          client.query.questParty.findFirst(),
          client.query.userData.findMany({ where: eq(userData.isAi, false) }),
          client.query.battle.findMany(),
          client.query.battleHistory.findMany(),
        ]);
        expect(humans.find((human) => human.userId === "helper")?.longitude).toBe(
          timing === "co-located" ? 12 : 13,
        );
        expect(humans.find((human) => human.userId === "leader")?.longitude).toBe(
          timing === "all before combat preload" ? 13 : 12,
        );
        if (timing === "co-located") {
          const battleId = "battleId" in result ? result.battleId : undefined;
          expect(battleId).toBeString();
          expect(savedParty?.battleId).toBe(battleId);
          expect(battles).toHaveLength(1);
          expect(battles[0]?.battleType).toBe(battleType);
          expect(
            humans.every(
              (human) => human.status === "BATTLE" && human.battleId === battleId,
            ),
          ).toBe(true);
          expect(
            battles[0]?.usersState.filter((fighter) =>
              ["leader", "helper"].includes(fighter.controllerId),
            ),
          ).toHaveLength(2);
        } else {
          expect(savedParty?.battleId).toBeNull();
          expect(
            humans.every(
              (human) => human.status === "AWAKE" && human.battleId === null,
            ),
          ).toBe(true);
          expect(battles).toHaveLength(0);
          expect(histories).toHaveLength(0);
          if (timing.includes("combat preload"))
            expect(result.message).toBe("Quest team membership or location changed");
          if (timing === "before participant claim")
            expect(result.message).toBe("Attack failed, did the target move?");
        }
      });
    }
  }
});
