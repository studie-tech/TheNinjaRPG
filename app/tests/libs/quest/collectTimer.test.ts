import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import { getCollectDeadline } from "@/utils/time";
import { DecreaseGatheringTime, IncreaseGatheringYield } from "@/validators/combat";
import { QuestTracker } from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../../setup/quest";

// Timed collect_item objectives compare Date.now() with the saved deadline, falling
// back to timestamp plus configured duration for older trackers. The spy controls
// both collection starts and exact completion boundaries.
const START = Date.UTC(2026, 8, 16, 12, 0, 0);
let nowMs = START;

beforeEach(() => {
  nowMs = START;
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const makeCollectUser = (collectTimeMinutes: number, timestamp?: string) => {
  const location = { sector: 1, longitude: 1, latitude: 1 };
  const objective = {
    id: "collect",
    task: "collect_item",
    ...location,
    collectItemIds: ["collected-item"],
    item_name: "Herb",
    collect_time_minutes: collectTimeMinutes,
  };
  const quest = trackerQuest("timed-collect-quest", [objective], "mission", {
    retryDelay: "none",
  });
  return trackerUser(
    [quest],
    [
      {
        id: quest.id,
        startAt: "2026-01-01T00:00:00.000Z",
        goals: [{ id: objective.id, ...(timestamp ? { timestamp } : {}) }],
      },
    ],
    { userId: "collector", ...location, status: "AWAKE", useritems: [] },
  );
};

const evaluate = (user: Parameters<typeof getNewTrackers>[0]) => {
  const result = getNewTrackers(user, [{ task: "collect_item" }]);
  const goal = result.trackers[0]?.goals.find(({ id }) => id === "collect");
  const granted = result.consequences.some(
    (c) => c.type === "add_item" && c.ids?.includes("collected-item"),
  );
  return { goal, granted, result };
};

describe("getNewTrackers — timed collect_item", () => {
  it("starts the timer on first arrival instead of granting the item", () => {
    const { goal, granted, result } = evaluate(makeCollectUser(0.5));
    expect(goal?.done).toBeUndefined();
    expect(Number.isFinite(Date.parse(goal?.timestamp ?? ""))).toBe(true);
    expect(granted).toBe(false);
    expect(result.notifications.some((n) => n.includes("started collecting"))).toBe(
      true,
    );
  });

  it("formats the collection duration in the start notification", () => {
    expect(evaluate(makeCollectUser(60)).result.notifications).toContain(
      "You started collecting. This will take 60m.",
    );
  });

  it("rejects a request that arrives just before the deadline", () => {
    const startedAt = new Date(START).toISOString();
    nowMs = START + 30_000 - 1;
    const { goal, granted } = evaluate(makeCollectUser(0.5, startedAt));
    expect(goal?.done).toBeUndefined();
    expect(granted).toBe(false);
  });

  it("grants the item at the exact deadline, when the client countdown fires onFinish", () => {
    const startedAt = new Date(START).toISOString();
    nowMs = START + 30_000;
    const { goal, granted } = evaluate(makeCollectUser(0.5, startedAt));
    expect(goal?.done).toBe(true);
    expect(granted).toBe(true);
  });

  it("does not round a fractional-second deadline up to the next whole second", () => {
    // 0.301 min = 18.06 s. A floored elapsed-seconds compare would hold this until 19 s.
    const startedAt = new Date(START).toISOString();
    nowMs = START + 18_500;
    const { goal, granted } = evaluate(makeCollectUser(0.301, startedAt));
    expect(goal?.done).toBe(true);
    expect(granted).toBe(true);
  });
});

const withGatheringBonus = (power = 10, collectTimeMinutes = 1) => {
  const player = makeCollectUser(collectTimeMinutes);
  player.userQuests[0]!.quest.questType = "gathering";
  player.bloodline = {
    effects: [DecreaseGatheringTime.parse({ power })],
  } as NonNullable<typeof player.bloodline>;
  return player;
};

describe("gathering collection snapshots", () => {
  it("persists yield at collection start through bonus changes and completion", () => {
    const player = withGatheringBonus();
    player.bloodline!.effects.push(IncreaseGatheringYield.parse({ power: 2 }));
    const started = evaluate(player);
    player.questData = started.result.trackers.map((tracker) =>
      QuestTracker.parse(tracker),
    );
    expect(player.questData[0]!.goals[0]!.gatheringBonusQuantity).toBe(2);
    player.bloodline!.effects = [IncreaseGatheringYield.parse({ power: 7 })];
    nowMs = START + 1000;
    expect(evaluate(player).goal?.gatheringBonusQuantity).toBe(2);
    nowMs = START + 54_000;
    const completed = evaluate(player);
    expect(completed.granted).toBe(true);
    expect(completed.goal?.gatheringBonusQuantity).toBe(2);
  });
  it("clears captured yield on departure and captures the new bonus on return", () => {
    const player = withGatheringBonus();
    player.bloodline!.effects.push(IncreaseGatheringYield.parse({ power: 2 }));
    player.questData = evaluate(player).result.trackers;
    player.longitude = 2;
    const left = evaluate(player);
    expect(left.goal?.gatheringBonusQuantity).toBeUndefined();
    player.questData = left.result.trackers;
    player.longitude = 1;
    player.bloodline!.effects = [IncreaseGatheringYield.parse({ power: 7 })];
    expect(evaluate(player).goal?.gatheringBonusQuantity).toBe(7);
  });
  it("does not add a claim-time bonus to legacy timers", () => {
    const player = withGatheringBonus();
    player.bloodline!.effects.push(IncreaseGatheringYield.parse({ power: 2 }));
    player.questData![0]!.goals[0]!.timestamp = new Date(START).toISOString();
    nowMs = START + 60_000;
    const completed = evaluate(player);
    expect(completed.granted).toBe(true);
    expect(completed.goal?.gatheringBonusQuantity).toBeUndefined();
  });
  it("captures yield for untimed gathering collections", () => {
    const player = withGatheringBonus();
    const objective = player.userQuests[0]!.quest.content.objectives[0]!;
    if ("collect_time_minutes" in objective) objective.collect_time_minutes = 0;
    player.bloodline!.effects.push(IncreaseGatheringYield.parse({ power: 2 }));
    expect(evaluate(player)).toMatchObject({
      granted: true,
      goal: { gatheringBonusQuantity: 2 },
    });
  });
  it("saves the reduced deadline and checks its exact completion boundary", () => {
    const player = withGatheringBonus();
    const first = evaluate(player);
    expect(first.goal?.collectDeadline).toBe(new Date(START + 54_000).toISOString());
    player.questData = first.result.trackers;
    nowMs = START + 53_999;
    expect(evaluate(player).granted).toBe(false);
    nowMs += 1;
    expect(evaluate(player).granted).toBe(true);
    expect(getCollectDeadline(first.goal!, 1)).toEqual(new Date(START + 54_000));
  });
  it("does not recalculate a running timer after passive bonuses change", () => {
    const player = withGatheringBonus();
    const first = evaluate(player);
    player.questData = first.result.trackers;
    player.bloodline!.effects = [DecreaseGatheringTime.parse({ power: 59 })];
    nowMs = START + 1000;
    expect(evaluate(player).granted).toBe(false);
    expect(evaluate(player).goal?.collectDeadline).toBe(first.goal?.collectDeadline);
    nowMs = START + 54_000;
    expect(evaluate(player).granted).toBe(true);
  });
  it("leaves old timers at their original duration", () => {
    const player = withGatheringBonus(59);
    player.questData![0]!.goals[0]!.timestamp = new Date(START).toISOString();
    nowMs = START + 59_999;
    expect(evaluate(player).granted).toBe(false);
    expect(evaluate(player).goal?.collectDeadline).toBeUndefined();
    nowMs += 1;
    expect(evaluate(player).granted).toBe(true);
  });
  it("clears both fields on departure and captures a new bonus on return", () => {
    const player = withGatheringBonus();
    player.questData = evaluate(player).result.trackers;
    player.longitude = 2;
    const left = evaluate(player);
    expect(left.goal?.timestamp).toBeUndefined();
    expect(left.goal?.collectDeadline).toBeUndefined();
    player.questData = left.result.trackers;
    player.longitude = 1;
    player.bloodline!.effects = [DecreaseGatheringTime.parse({ power: 20 })];
    nowMs = START + 2000;
    expect(evaluate(player).goal?.collectDeadline).toBe(
      new Date(START + 50_000).toISOString(),
    );
  });
  it("keeps unrelated quests and untimed objectives unchanged", () => {
    const player = withGatheringBonus();
    player.userQuests[0]!.quest.questType = "mission";
    expect(evaluate(player).goal?.collectDeadline).toBe(
      new Date(START + 60_000).toISOString(),
    );
    const untimed = makeCollectUser(0);
    expect(evaluate(untimed).granted).toBe(true);
    expect(evaluate(untimed).goal?.collectDeadline).toBeUndefined();
  });
  it("caps stacked gathering reductions before saving the deadline", () => {
    const player = withGatheringBonus(60);
    player.bloodline!.effects.push(DecreaseGatheringTime.parse({ power: 60 }));
    expect(evaluate(player).goal?.collectDeadline).toBe(
      new Date(START + 24_000).toISOString(),
    );
  });
  it("keeps the one-second minimum for short collections", () => {
    expect(evaluate(withGatheringBonus(60, 0.01)).goal?.collectDeadline).toBe(
      new Date(START + 1000).toISOString(),
    );
  });
});
