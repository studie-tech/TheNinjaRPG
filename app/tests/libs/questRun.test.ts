import { describe, expect, it } from "bun:test";
import type { UserQuest } from "@/drizzle/schema";
import { getNewTrackers } from "@/libs/quest";
import {
  findConsecutiveQuestId,
  getIsolatedPyramid,
  getQuestEntryRequirements,
  getQuestEntryStock,
  hasQuestContentChanged,
  isBetweenPyramidBattles,
  isPyramidRestrictedProcedure,
  isQuestAttemptPaused,
  nameQuestEntryStock,
} from "@/libs/questRun";
import { getTagSchema } from "@/validators/combat";
import {
  DefeatOpponents,
  InstantStartBattleObjective,
  questEntryItemsSchema,
} from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../setup/quest";

describe("quest run configuration", () => {
  it("preserves missing starting pools and defaults effects/tickets to empty", () => {
    const objective = InstantStartBattleObjective.parse({
      id: "fight",
      task: "start_battle",
      opponentAIs: [{ ids: ["foe"], number: 1 }],
    });
    expect(objective.givePools).toBeUndefined();
    expect(objective.applyBuffs).toEqual([]);
    expect(objective.applyDebuffs).toEqual([]);
    expect(questEntryItemsSchema.parse(undefined)).toEqual([]);
  });
  it("validates shared battle pool percentages and complete, timed player effects", () => {
    const base = { id: "fight", opponentAIs: [{ ids: ["foe"], number: 1 }] };
    for (const schema of [InstantStartBattleObjective, DefeatOpponents]) {
      const task = schema === DefeatOpponents ? "defeat_opponents" : "start_battle";
      for (const givePools of [0, 35, 100])
        expect(schema.parse({ ...base, task, givePools }).givePools).toBe(givePools);
      for (const givePools of [-1, 101])
        expect(schema.safeParse({ ...base, task, givePools }).success).toBe(false);
      const tag = getTagSchema("increasedamagegiven").parse({ rounds: 3 });
      expect(schema.safeParse({ ...base, task, applyBuffs: [tag] }).success).toBe(true);
      expect(
        schema.safeParse({ ...base, task, applyBuffs: [{ ...tag, rounds: undefined }] })
          .success,
      ).toBe(false);
      expect(schema.safeParse({ ...base, task, applyDebuffs: [tag] }).success).toBe(
        false,
      );
      expect(
        schema.safeParse({ ...base, task, applyBuffs: [{ type: "summon", rounds: 3 }] })
          .success,
      ).toBe(false);
    }
  });
  it("adds duplicate item quantities without accepting fractional quantities", () => {
    expect(
      getQuestEntryRequirements({
        entryItems: [
          { ids: ["a", "b"], number: 2 },
          { ids: ["a"], number: 1 },
        ],
      }),
    ).toEqual([
      { itemId: "a", quantity: 3 },
      { itemId: "b", quantity: 2 },
    ]);
    expect(questEntryItemsSchema.safeParse([{ ids: ["a"], number: 1.5 }]).success).toBe(
      false,
    );
  });
  it("sums carried stacks per entry item and names items from the catalogue", () => {
    const carried = [
      { itemId: "a", quantity: 1, item: { name: "Key" } },
      { itemId: "a", quantity: 2, item: { name: "Key" } },
    ];
    const stock = getQuestEntryStock(
      { entryItems: [{ ids: ["a", "b"], number: 1 }] },
      carried,
    );
    expect(stock).toEqual([
      { itemId: "a", quantity: 1, name: "Key", owned: 3 },
      { itemId: "b", quantity: 1, name: "b", owned: 0 },
    ]);
    expect(
      nameQuestEntryStock(stock, [{ id: "b", name: "Ticket" }]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["Key", "Ticket"]);
    expect(nameQuestEntryStock(stock, undefined).map((entry) => entry.name)).toEqual([
      "Key",
      "b",
    ]);
  });
  it("keeps hidden/edited runs isolated until they end", () => {
    const entry = {
      isolated: true,
      completed: 0,
      endAt: null,
      questType: "battlepyramid",
      questVersion: new Date(0),
      quest: { hidden: true, updatedAt: new Date(1000) },
    } as UserQuest;
    expect(getIsolatedPyramid({ userQuests: [entry] })).toBe(entry);
    expect(hasQuestContentChanged(entry)).toBe(true);
    expect(
      getIsolatedPyramid({ userQuests: [{ ...entry, endAt: new Date() }] }),
    ).toBeUndefined();
  });
  it("blocks inventory, outside healing and travel while retaining quest and battle controls", () => {
    for (const path of [
      "item.consume",
      "item.toggleEquip",
      "hospital.npcHeal",
      "village.buyFood",
      "combat.battleArenaHeal",
      "travel.startTravel",
      "bank.toBank",
      "quests.startRandom",
      "combat.startArenaBattle",
      "item.update",
      "comments.sendTypingIndicator",
      "comments.createConversationComment",
    ])
      expect(isPyramidRestrictedProcedure(path)).toBe(true);
    for (const path of [
      "quests.abandon",
      "quests.checkRewards",
      "quests.retryBattle",
      "combat.performAction",
      "combat.toggleAutoCombat",
      "combat.iAmHere",
      "combat.updateCombatLoadout",
      "profile.updatePreferences",
      "comments.fetchConversationComment",
      "staff.forceAwake",
    ])
      expect(isPyramidRestrictedProcedure(path)).toBe(false);
  });
  it("allows continuation only between battles of an open isolated run", () => {
    const run = { isolated: true, completed: 0, endAt: null } as UserQuest;
    const user = { status: "BATTLE" as const, battleId: null, userQuests: [run] };
    expect(isBetweenPyramidBattles(user)).toBe(true);
    expect(isBetweenPyramidBattles({ ...user, battleId: "fight" })).toBe(false);
    expect(isBetweenPyramidBattles({ ...user, status: "AWAKE" })).toBe(false);
    expect(
      isBetweenPyramidBattles({ ...user, userQuests: [{ ...run, endAt: new Date() }] }),
    ).toBe(false);
  });
});

it("cannot advance a ticketed floor by defeating its enemy in an unrelated battle", () => {
  const objective = InstantStartBattleObjective.parse({
    id: "floor",
    task: "start_battle",
    opponentAIs: [{ ids: ["enemy"], number: 1 }],
  });
  const quest = trackerQuest("pyramid", [objective], "battlepyramid", {
    name: "Pyramid",
    requiredLevel: 0,
    maxLevel: 100,
    content: { entryItems: [{ ids: ["ticket"], number: 1 }] },
  });
  const user = trackerUser(
    [{ quest, endAt: null, entryPaid: false, previousAttempts: 1 }],
    [{ id: "pyramid", startAt: new Date().toISOString(), goals: [] }],
    { userId: "hero", status: "BATTLE", sector: 0, items: [] },
  );
  const task = [{ task: "start_battle" as const, contentId: "enemy", text: "Won" }];
  expect(getNewTrackers(user, task).trackers[0]?.goals[0]?.done).toBe(false);
  expect(
    getNewTrackers(user, task, {
      inWarTornSector: false,
      isWarParticipant: false,
      questBattleSource: { questId: "pyramid", objectiveId: "another-floor" },
    }).trackers[0]?.goals[0]?.done,
  ).toBe(false);
  expect(
    getNewTrackers(user, task, {
      inWarTornSector: false,
      isWarParticipant: false,
      questBattleSource: { questId: "pyramid", objectiveId: "floor" },
    }).trackers[0]?.goals[0]?.done,
  ).toBe(true);
});

describe("isQuestAttemptPaused", () => {
  const attempt = (hidden: boolean, questVersion: Date | null) =>
    ({
      questType: "battlepyramid",
      isolated: false,
      questVersion,
      quest: { hidden, updatedAt: new Date(1000) },
    }) as never;

  it("pauses edited attempts for every role", () => {
    expect(isQuestAttemptPaused(attempt(false, new Date(500)), "USER")).toBe(true);
    expect(isQuestAttemptPaused(attempt(false, new Date(500)), "CONTENT")).toBe(true);
  });

  it("pauses hidden attempts only for roles that cannot play them", () => {
    expect(isQuestAttemptPaused(attempt(true, new Date(1000)), "USER")).toBe(true);
    expect(isQuestAttemptPaused(attempt(true, new Date(1000)), "CONTENT")).toBe(false);
    expect(isQuestAttemptPaused(attempt(false, new Date(1000)), "USER")).toBe(false);
  });
});

describe("findConsecutiveQuestId", () => {
  const entry = (questId: string, consecutiveObjectives: boolean) =>
    ({ questId, quest: { consecutiveObjectives } }) as never;

  it("picks the last updated quest with consecutive objectives", () => {
    const userQuests = [entry("a", true), entry("b", false), entry("c", true)];
    expect(findConsecutiveQuestId(userQuests, ["a", "b", "c"])).toBe("c");
    expect(findConsecutiveQuestId(userQuests, ["a", "b"])).toBe("a");
  });

  it("finds nothing for unknown or plain quests", () => {
    expect(findConsecutiveQuestId([entry("b", false)], ["b", "z"])).toBeUndefined();
    expect(findConsecutiveQuestId(undefined, ["a"])).toBeUndefined();
  });
});
