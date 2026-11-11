import { describe, expect, it } from "bun:test";
import type { Quest, QuestParty } from "@/drizzle/schema";
import { getNewTrackers } from "@/libs/quest";
import { getReward } from "@/libs/quest/rewards";
import { verifyQuestContentForSave } from "@/libs/quest/validation";
import {
  mergePartyProgress,
  projectPartyTracker,
  recordPartyContributions,
} from "@/libs/questParty";
import { AllObjectives, ObjectiveTracker, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";

const fixture = (task = "stats_trained", value = 10) => {
  const goal = ObjectiveTracker.parse({ id: "goal" });
  const quest = {
    id: "quest",
    name: "Team quest",
    questType: "event",
    hidden: false,
    teamEnabled: true,
    consecutiveObjectives: false,
    requiredVillage: null,
    requiredLevel: 1,
    maxLevel: 100,
    maxAttempts: 1,
    maxCompletes: 1,
    retryDelay: "none",
    content: {
      objectives: [AllObjectives.parse({ id: "goal", task, value })],
      reward: ObjectiveReward.parse({ reward_money: 100, reward_exp: 100 }),
    },
  } as Quest;
  const party = {
    isPublic: false,
    battleId: null,
    createdAt: new Date(),
    id: "party",
    questId: "quest",
    maxPlayers: 3,
    leaderId: "one",
    memberIds: ["one", "two"],
    invitedUserIds: [],
    tracker: QuestTracker.parse({ id: "quest", goals: [goal] }),
    contributions: {},
    version: 0,
  } as QuestParty;
  return { goal, quest, party };
};
const partyUser = (quest: { id: string }, questData: unknown[], patch: object) =>
  ({
    level: 50,
    rank: "JONIN",
    role: "USER",
    status: "AWAKE",
    userQuests: [
      { id: "history", questId: quest.id, completed: 0, previousCompletes: 0, quest },
    ],
    completedQuests: [],
    questData,
    ...patch,
  }) as unknown as Parameters<typeof getNewTrackers>[0];
const itemObjective = (task: "collect_item" | "deliver_item") =>
  AllObjectives.parse({
    id: "goal",
    task,
    ...(task === "collect_item"
      ? { collectItemIds: ["scroll"] }
      : { deliverItemIds: ["scroll"] }),
    item_name: "Scroll",
    sector: 1,
    longitude: 1,
    latitude: 1,
    sectorType: "specific",
    locationType: "specific",
  });
const contributor = (party: QuestParty, userId: string, value: number) => ({
  userId,
  questData: [
    {
      ...projectPartyTracker(party),
      party: {
        id: party.id,
        generation: party.tracker.generation ?? 0,
        contributions: [ObjectiveTracker.parse({ id: "goal", value })],
      },
    },
  ],
});

describe("quest team progress", () => {
  it("shares an authored failure branch after a bound NPC is deleted without failing the team", () => {
    const { quest, party } = fixture();
    quest.consecutiveObjectives = true;
    quest.content.objectives = [
      AllObjectives.parse({
        id: "goal",
        task: "defeat_opponents",
        overworldPlacementId: "deleted",
        opponentAIs: [{ ids: ["enemy"], number: 1 }],
        failObjectiveId: "recovery",
      }),
      AllObjectives.parse({ id: "recovery", task: "stats_trained", value: 10 }),
    ];
    const user = partyUser(quest, [projectPartyTracker(party)], {
      userId: "one",
      questPartyId: party.id,
    });
    const result = getNewTrackers(user, [], undefined, new Map());
    expect(result.consequences.some((entry) => entry.type === "fail_quest")).toBe(
      false,
    );
    const shared = mergePartyProgress(
      party,
      [{ userId: user.userId, questData: result.trackers }],
      quest,
    );
    expect(shared.tracker.failed).toBeFalsy();
    expect(
      projectPartyTracker({ ...party, ...shared }).goals.find(
        (entry) => entry.id === "goal",
      ),
    ).toMatchObject({ done: true, selectedNextObjectiveId: "recovery" });
  });
  it("adds simultaneous contributions and never reapplies a member snapshot", () => {
    const { quest, party } = fixture();
    const members = [contributor(party, "one", 6), contributor(party, "two", 4)];
    const merged = mergePartyProgress(party, members, quest);
    expect(merged.tracker.goals[0]?.value).toBe(10);
    expect(merged.tracker.goals[0]?.done).toBe(true);
    expect(mergePartyProgress({ ...party, ...merged }, members, quest)).toEqual(merged);
    expect(
      mergePartyProgress({ ...party, ...merged }, [members[1]!], quest).tracker.goals[0]
        ?.value,
    ).toBe(10);
  });
  it("records only new local progress after copying the shared counter", () => {
    const { party } = fixture();
    party.tracker.goals[0]!.value = 7;
    const before = projectPartyTracker(party);
    const after = structuredClone(before);
    after.goals[0]!.value += 2;
    recordPartyContributions([before], [after]);
    expect(after.party?.contributions[0]?.value).toBe(2);
  });
  it("uses a maximum for passive requirements instead of adding players' levels", () => {
    const { quest, party } = fixture("user_level", 60);
    const members = [contributor(party, "one", 35), contributor(party, "two", 40)];
    members[0]!.questData[0]!.goals[0]!.value = 35;
    members[1]!.questData[0]!.goals[0]!.value = 40;
    const merged = mergePartyProgress(party, members, quest);
    expect(merged.tracker.goals[0]?.value).toBe(40);
    expect(merged.tracker.goals[0]?.done).toBe(false);
  });
  it("uses a maximum for completion snapshots instead of adding lifetime totals", () => {
    const { quest, party } = fixture("dungeons_completed", 60);
    const members = [contributor(party, "one", 35), contributor(party, "two", 40)];
    members[0]!.questData[0]!.goals[0]!.value = 35;
    members[1]!.questData[0]!.goals[0]!.value = 40;
    expect(mergePartyProgress(party, members, quest).tracker.goals[0]?.value).toBe(40);
  });

  it("preserves personal reward collection and timers without transferring them to replacements", () => {
    const { party } = fixture();
    const personal = projectPartyTracker(party);
    personal.goals[0]!.collected = true;
    personal.goals[0]!.timestamp = "2026-10-01T00:00:00.000Z";
    personal.goals[0]!.collectDeadline = "2026-10-01T00:00:50.000Z";
    personal.goals[0]!.gatheringBonusQuantity = 2;
    party.tracker.goals[0]!.done = true;
    expect(projectPartyTracker(party, personal).goals[0]).toMatchObject({
      done: true,
      collected: true,
      timestamp: personal.goals[0]!.timestamp,
      collectDeadline: personal.goals[0]!.collectDeadline,
      gatheringBonusQuantity: 2,
    });
    expect(projectPartyTracker(party).goals[0]?.collected).toBe(false);
    expect(projectPartyTracker(party).goals[0]?.timestamp).toBeUndefined();
    expect(projectPartyTracker(party).goals[0]?.collectDeadline).toBeUndefined();
    expect(projectPartyTracker(party).goals[0]?.gatheringBonusQuantity).toBeUndefined();
  });
  it("ignores contributions from the previous reset generation", () => {
    const { quest, party } = fixture();
    const member = contributor(party, "one", 10);
    party.tracker.generation = 1;
    expect(mergePartyProgress(party, [member], quest).tracker.goals[0]?.value).toBe(0);
    expect(projectPartyTracker(party, member.questData[0]).party).toEqual({
      id: party.id,
      generation: 1,
      contributions: [],
    });
  });
  it("keeps the first selected dialog branch", () => {
    const { quest, party } = fixture();
    const first = contributor(party, "one", 0);
    first.questData[0]!.party.contributions[0]!.selectedNextObjectiveId = "left";
    const merged = mergePartyProgress(party, [first], quest);
    const second = contributor(party, "two", 0);
    second.questData[0]!.party.contributions[0]!.selectedNextObjectiveId = "right";
    expect(
      mergePartyProgress({ ...party, ...merged }, [second], quest).tracker.goals[0]
        ?.selectedNextObjectiveId,
    ).toBe("left");
  });
  it("drops party metadata when continuing solo after leaving", () => {
    const { quest, party } = fixture();
    const user = partyUser(quest, [projectPartyTracker(party)], {
      userId: "one",
      questPartyId: null,
    });
    expect(
      getNewTrackers(user, [{ task: "stats_trained", increment: 1 }]).trackers[0]
        ?.party,
    ).toBeUndefined();
  });
  it("completed helpers emit no reward or completion events to other quests", () => {
    const { quest, party } = fixture();
    party.tracker.goals[0]!.done = true;
    const other = {
      ...quest,
      id: "other",
      content: {
        ...quest.content,
        objectives: [
          AllObjectives.parse({
            id: "other-goal",
            task: "complete_specific_quest",
            completeQuestIds: [quest.id],
            value: 10,
          }),
        ],
      },
    };
    const user = partyUser(quest, [projectPartyTracker(party)], {
      userId: "one",
      questPartyId: party.id,
      items: [],
      userQuests: [
        {
          id: `party-${party.id}`,
          questId: quest.id,
          completed: 0,
          previousCompletes: 0,
          quest,
        },
        {
          id: "other-history",
          questId: other.id,
          completed: 0,
          previousCompletes: 0,
          quest: other,
        },
      ],
    });
    const result = getReward(user, quest.id);
    expect(result.resolved).toBe(true);
    expect(result.rewards.reward_money).toBe(0);
    expect(result.rewards.reward_exp).toBe(0);
    expect(
      result.trackers.find((entry) => entry.id === other.id)?.goals[0]?.value,
    ).toBe(0);
  });
});

it("partial resets retain unrelated personal reward receipts", () => {
  const { party } = fixture();
  party.tracker.goals.push(ObjectiveTracker.parse({ id: "unaffected", done: true }));
  const personal = projectPartyTracker(party);
  personal.goals.forEach((goal) => {
    goal.collected = true;
    goal.partyEffectsApplied = true;
  });
  party.tracker.generation = 1;
  party.tracker.resetGenerations = { goal: 1 };
  const projected = projectPartyTracker(party, personal);
  expect(projected.goals.find((goal) => goal.id === "goal")?.collected).toBe(false);
  expect(projected.goals.find((goal) => goal.id === "unaffected")?.collected).toBe(
    true,
  );
  expect(
    projected.goals.find((goal) => goal.id === "unaffected")?.partyEffectsApplied,
  ).toBe(true);
});

it("each member starts shared follow-on quests once", () => {
  const { quest, party } = fixture();
  quest.content.objectives = [
    AllObjectives.parse({ id: "goal", task: "new_quest", newQuestIds: ["next"] }),
  ];
  party.tracker.goals[0]!.done = true;
  const user = partyUser(quest, [projectPartyTracker(party)], {
    userId: "one",
    questPartyId: party.id,
  });
  const first = getNewTrackers(
    user,
    [{ task: "any" }],
    undefined,
    undefined,
    undefined,
    true,
  );
  expect(
    first.consequences.some(
      (entry) => entry.type === "start_quest" && entry.ids.includes("next"),
    ),
  ).toBe(true);
  user.questData = [projectPartyTracker(party, first.trackers[0])];
  expect(
    getNewTrackers(
      user,
      [{ task: "any" }],
      undefined,
      undefined,
      undefined,
      true,
    ).consequences.some((entry) => entry.type === "start_quest"),
  ).toBe(false);
});

it("replacements receive undelivered quest items once and shared delivery removes personal copies", () => {
  const { quest, party } = fixture();
  quest.content.objectives = [
    AllObjectives.parse({
      id: "goal",
      task: "collect_item",
      collectItemIds: ["scroll"],
      item_name: "Secret scroll",
      sector: 1,
      longitude: 1,
      latitude: 1,
    }),
    AllObjectives.parse({
      id: "delivery",
      task: "deliver_item",
      deliverItemIds: ["scroll"],
      item_name: "Secret scroll",
      sector: 2,
      longitude: 1,
      latitude: 1,
    }),
  ];
  party.tracker.goals = [
    ObjectiveTracker.parse({ id: "goal", done: true }),
    ObjectiveTracker.parse({ id: "delivery" }),
  ];
  const user = partyUser(quest, [projectPartyTracker(party)], {
    userId: "replacement",
    questPartyId: party.id,
    sector: 3,
    longitude: 1,
    latitude: 1,
    items: [],
  });
  const first = getNewTrackers(
    user,
    [{ task: "any" }],
    undefined,
    undefined,
    undefined,
    true,
  );
  expect(first.consequences.filter((c) => c.type === "add_item")).toEqual([
    { type: "add_item", ids: ["scroll"] },
  ]);
  user.questData = [projectPartyTracker(party, first.trackers[0])];
  expect(
    getNewTrackers(
      user,
      [{ task: "any" }],
      undefined,
      undefined,
      undefined,
      true,
    ).consequences.some((c) => c.type === "add_item"),
  ).toBe(false);
  party.tracker.goals[1]!.done = true;
  user.questData = [projectPartyTracker(party, user.questData![0])];
  expect(
    getNewTrackers(
      user,
      [{ task: "any" }],
      undefined,
      undefined,
      undefined,
      true,
    ).consequences.some((c) => c.type === "remove_item"),
  ).toBe(true);
  user.questData = [projectPartyTracker(party)];
  expect(
    getNewTrackers(
      user,
      [{ task: "any" }],
      undefined,
      undefined,
      undefined,
      true,
    ).consequences.some((c) => c.type === "add_item"),
  ).toBe(false);
});

it("retains the undelivered quantity when two shared collections reuse an item before one delivery", () => {
  for (const consecutive of [false, true])
    for (const detached of [false, true]) {
      const { quest, party } = fixture();
      quest.consecutiveObjectives = consecutive;
      quest.content.objectives = [
        AllObjectives.parse({
          id: "delivery",
          task: "deliver_item",
          deliverItemIds: ["scroll"],
          item_name: "Scroll",
          nextObjectiveId: "wait",
        }),
        AllObjectives.parse({
          id: "second",
          task: "collect_item",
          collectItemIds: ["scroll"],
          item_name: "Scroll",
          nextObjectiveId: "delivery",
        }),
        AllObjectives.parse({
          id: "first",
          task: "collect_item",
          collectItemIds: ["scroll"],
          item_name: "Scroll",
          nextObjectiveId: "second",
        }),
        AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
      ];
      expect(
        verifyQuestContentForSave(quest.content.objectives, consecutive).check,
      ).toBe(true);
      party.tracker.goals = [
        ObjectiveTracker.parse({
          id: "first",
          done: true,
          selectedNextObjectiveId: "second",
        }),
        ObjectiveTracker.parse({
          id: "second",
          done: true,
          selectedNextObjectiveId: "delivery",
        }),
        ObjectiveTracker.parse({
          id: "delivery",
          done: true,
          selectedNextObjectiveId: "wait",
        }),
        ObjectiveTracker.parse({ id: "wait" }),
      ];
      const tracker = projectPartyTracker(party);
      if (detached) delete tracker.party;
      const user = partyUser(quest, [tracker], {
        userId: "replacement",
        questPartyId: detached ? null : party.id,
        sector: 3,
        longitude: 1,
        latitude: 1,
        items: [],
      });
      const result = getNewTrackers(
        user,
        [{ task: "any" }],
        undefined,
        undefined,
        undefined,
        true,
      );
      expect(
        result.consequences.filter((consequence) => consequence.type === "add_item"),
      ).toEqual([{ type: "add_item", ids: ["scroll"] }]);
      expect(
        result.trackers[0]?.goals
          .filter((goal) => goal.done)
          .every((goal) => goal.partyEffectsApplied),
      ).toBe(true);
      user.questData = result.trackers;
      expect(
        getNewTrackers(
          user,
          [{ task: "any" }],
          undefined,
          undefined,
          undefined,
          true,
        ).consequences.some((consequence) => consequence.type === "add_item"),
      ).toBe(false);
    }
});

for (const consecutive of [false, true])
  for (const detached of [false, true])
    for (const applied of [false, true]) {
      it(`matches pending delivery items to personal collection receipts (${consecutive ? "consecutive" : "parallel"}, ${detached ? "detached" : "attached"}, ${applied ? "applied" : "pending"})`, () => {
        const { quest, party } = fixture();
        quest.consecutiveObjectives = consecutive;
        quest.content.objectives = [
          AllObjectives.parse({
            id: "delivery",
            task: "deliver_item",
            deliverItemIds: ["scroll", "scroll", "spare"],
            item_name: "Scrolls",
            nextObjectiveId: "unmatched",
          }),
          AllObjectives.parse({
            id: "second",
            task: "collect_item",
            collectItemIds: ["spare"],
            item_name: "Spare",
            nextObjectiveId: "delivery",
          }),
          AllObjectives.parse({
            id: "first",
            task: "collect_item",
            collectItemIds: ["scroll"],
            item_name: "Scroll",
            nextObjectiveId: "second",
          }),
          AllObjectives.parse({
            id: "unmatched",
            task: "deliver_item",
            deliverItemIds: ["scroll"],
            item_name: "Scroll",
            nextObjectiveId: "wait",
          }),
          AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
        ];
        expect(
          verifyQuestContentForSave(quest.content.objectives, consecutive).check,
        ).toBe(true);
        party.tracker.goals = [
          ObjectiveTracker.parse({
            id: "first",
            done: true,
            selectedNextObjectiveId: "second",
          }),
          ObjectiveTracker.parse({
            id: "second",
            done: true,
            selectedNextObjectiveId: "delivery",
          }),
          ObjectiveTracker.parse({
            id: "delivery",
            done: true,
            selectedNextObjectiveId: "unmatched",
          }),
          ObjectiveTracker.parse({
            id: "unmatched",
            done: true,
            selectedNextObjectiveId: "wait",
          }),
          ObjectiveTracker.parse({ id: "wait" }),
        ];
        const tracker = projectPartyTracker(party);
        tracker.goals.find((goal) => goal.id === "first")!.partyEffectsApplied =
          applied;
        if (detached) delete tracker.party;
        const user = partyUser(quest, [tracker], {
          userId: "helper",
          questPartyId: detached ? null : party.id,
          sector: 3,
          longitude: 1,
          latitude: 1,
          items: [],
        });
        const result = getNewTrackers(
          user,
          [{ task: "any" }],
          undefined,
          undefined,
          undefined,
          true,
        );
        expect(
          result.consequences.filter((consequence) => consequence.type === "add_item"),
        ).toEqual([]);
        expect(
          result.consequences.filter(
            (consequence) => consequence.type === "remove_item",
          ),
        ).toEqual(
          Array.from({ length: applied ? 2 : 1 }, () => ({
            type: "remove_item",
            ids: ["scroll"],
          })),
        );
        expect(
          result.trackers[0]?.goals
            .filter((goal) => goal.done)
            .every((goal) => goal.partyEffectsApplied),
        ).toBe(true);
        user.questData = result.trackers;
        expect(
          getNewTrackers(
            user,
            [{ task: "any" }],
            undefined,
            undefined,
            undefined,
            true,
          ).consequences.some(
            (consequence) =>
              consequence.type === "remove_item" || consequence.type === "add_item",
          ),
        ).toBe(false);
      });
    }

it("sums teammates' damage within one battle, without adding separate battles or replayed settlements", () => {
  const { quest, party } = fixture("damage_dealt", 2000);
  quest.content.objectives[0] = AllObjectives.parse({
    id: "goal",
    task: "damage_dealt",
    singleBattle: true,
    value: 2000,
  });
  const members = [contributor(party, "one", 600), contributor(party, "two", 600)];
  for (const member of members)
    member.questData[0]!.party.contributions[0]!.battleValues = { first: 600 };
  const merged = mergePartyProgress(party, members, quest);
  expect(merged.tracker.goals[0]?.value).toBe(1200);
  expect(mergePartyProgress({ ...party, ...merged }, members, quest)).toEqual(merged);
  members[0]!.questData[0]!.party.contributions[0]!.battleValues = {
    first: 600,
    second: 800,
  };
  members[1]!.questData[0]!.party.contributions[0]!.battleValues = {
    first: 600,
    third: 900,
  };
  expect(
    mergePartyProgress({ ...party, ...merged }, members, quest).tracker.goals[0]?.value,
  ).toBe(1200);
});

it("does not double single-battle damage when rebuilding a reset goal", () => {
  const { quest, party } = fixture("damage_dealt", 1000);
  quest.content.objectives[0] = AllObjectives.parse({
    id: "goal",
    task: "damage_dealt",
    singleBattle: true,
    value: 1000,
  });
  const member = contributor(party, "one", 600);
  member.questData[0]!.goals[0]!.battleValues = { first: 600 };
  member.questData[0]!.party.contributions[0]!.battleValues = { first: 600 };
  party.tracker.goals = [];
  const result = mergePartyProgress(party, [member], quest);
  expect(result.tracker.goals[0]?.value).toBe(600);
  expect(result.tracker.goals[0]?.done).toBe(false);
});

it("tracker-only processing defers personal team effects before and after departure until a consequence handler runs", () => {
  for (const detached of [false, true]) {
    const { quest, party } = fixture();
    quest.content.objectives = [
      AllObjectives.parse({ id: "goal", task: "new_quest", newQuestIds: ["next"] }),
    ];
    party.tracker.goals[0]!.done = true;
    const tracker = projectPartyTracker(party);
    if (detached) delete tracker.party;
    const user = partyUser(quest, [tracker], {
      userId: "one",
      questPartyId: detached ? null : party.id,
    });
    const deferred = getNewTrackers(user, [{ task: "stats_trained", increment: 1 }]);
    expect(deferred.consequences.some((c) => c.type === "start_quest")).toBe(false);
    expect(deferred.trackers[0]?.goals[0]?.partyEffectsApplied).toBe(false);
    user.questData = deferred.trackers;
    expect(
      getNewTrackers(
        user,
        [{ task: "any" }],
        undefined,
        undefined,
        undefined,
        true,
      ).consequences.some((c) => c.type === "start_quest"),
    ).toBe(true);
  }
});

it("collects a location item once when reward checking emits both any and collect_item", () => {
  const { quest, party } = fixture();
  quest.content.objectives = [
    AllObjectives.parse({
      id: "goal",
      task: "collect_item",
      collectItemIds: ["scroll"],
      item_name: "Secret scroll",
      sector: 1,
      longitude: 1,
      latitude: 1,
      sectorType: "specific",
      locationType: "specific",
    }),
  ];
  const user = partyUser(quest, [projectPartyTracker(party)], {
    userId: "one",
    questPartyId: party.id,
    sector: 1,
    longitude: 1,
    latitude: 1,
    items: [],
  });
  expect(
    getReward(user, quest.id).consequences.filter((c) => c.type === "add_item"),
  ).toEqual([{ type: "add_item", ids: ["scroll"] }]);
});

for (const task of ["collect_item", "deliver_item"] as const) {
  it(`uses personal effect receipts independently of shared completion (${task})`, () => {
    for (const done of [false, true])
      for (const applied of [false, true]) {
        const { quest, party } = fixture();
        quest.content.objectives = [itemObjective(task)];
        party.tracker.goals[0]!.done = done;
        const personal = projectPartyTracker(party);
        personal.goals[0]!.partyEffectsApplied = applied;
        const user = partyUser(quest, [projectPartyTracker(party, personal)], {
          userId: "one",
          questPartyId: party.id,
          sector: 1,
          longitude: 1,
          latitude: 1,
          useritems: [{ itemId: "scroll" }],
        });
        const result = getNewTrackers(
          user,
          [{ task: "any" }, { task }],
          undefined,
          undefined,
          undefined,
          true,
        );
        expect(
          result.consequences.filter(
            (consequence) =>
              consequence.type ===
              (task === "collect_item" ? "add_item" : "remove_item"),
          ),
        ).toHaveLength(applied ? 0 : 1);
        expect(result.trackers[0]?.goals[0]).toMatchObject({
          done: true,
          partyEffectsApplied: true,
        });
        expect(
          result.trackers[0]?.party?.contributions.some(
            (goal) => goal.id === "goal" && goal.done,
          ),
        ).toBe(!done);
      }
  });

  it(`invalidates only reset goals' personal effect receipts (${task})`, () => {
    for (const done of [false, true])
      for (const resetGoal of ["goal", "unrelated"]) {
        const { quest, party } = fixture();
        quest.content.objectives = [itemObjective(task)];
        const personal = projectPartyTracker(party);
        personal.goals[0]!.partyEffectsApplied = true;
        personal.goals[0]!.collected = true;
        party.tracker.goals[0]!.done = done;
        party.tracker.generation = 1;
        party.tracker.resetGenerations = { [resetGoal]: 1 };
        const projected = projectPartyTracker(party, personal);
        expect(projected.goals[0]?.partyEffectsApplied).toBe(resetGoal !== "goal");
        expect(projected.goals[0]?.collected).toBe(resetGoal !== "goal");
        const user = partyUser(quest, [projected], {
          userId: "one",
          questPartyId: party.id,
          sector: 1,
          longitude: 1,
          latitude: 1,
          useritems: [{ itemId: "scroll" }],
        });
        const result = getNewTrackers(
          user,
          [{ task: "any" }],
          undefined,
          undefined,
          undefined,
          true,
        );
        expect(
          result.consequences.filter(
            (consequence) =>
              consequence.type ===
              (task === "collect_item" ? "add_item" : "remove_item"),
          ),
        ).toHaveLength(resetGoal === "goal" ? 1 : 0);
        expect(result.trackers[0]?.goals[0]?.done).toBe(true);
      }
  });
}

it("retains the next objective after an instant team objective completes", () => {
  const { quest, party } = fixture();
  quest.consecutiveObjectives = true;
  quest.content.objectives = [
    AllObjectives.parse({
      id: "goal",
      task: "new_quest",
      newQuestIds: ["followon"],
      nextObjectiveId: "next-goal",
    }),
    AllObjectives.parse({ id: "next-goal", task: "stats_trained", value: 10 }),
  ];
  const user = partyUser(quest, [projectPartyTracker(party)], {
    userId: "one",
    questPartyId: party.id,
  });
  const result = getNewTrackers(user, [{ task: "any" }]);
  expect(result.trackers[0]?.goals[0]).toMatchObject({
    done: true,
    selectedNextObjectiveId: "next-goal",
  });
  expect(result.trackers[0]?.goals[1]?.done).toBe(false);
});
