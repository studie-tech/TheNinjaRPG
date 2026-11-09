import { describe, expect, it } from "bun:test";
import {
  getObjectiveSchema,
  QuestValidator,
  RaidObjective,
} from "@/validators/objectives";

const objective = (id: string) =>
  getObjectiveSchema("pvp_kills").parse({ id, task: "pvp_kills" });

const quest = (patch: object) => ({
  name: "Quest",
  description: "Quest description",
  successDescription: "Quest done",
  hidden: false,
  consecutiveObjectives: false,
  endsAt: null,
  startsAt: null,
  tierLevel: null,
  ...patch,
});

const messages = (input: object) =>
  QuestValidator.safeParse(input).error?.issues.map((issue) => issue.message) ?? [];

describe("daily quest objectives", () => {
  const COUNT_MESSAGE = "Daily quests must have between 3 and 7 objectives";
  const daily = (count: number, questType = "daily") =>
    quest({
      questType,
      content: {
        objectives: Array.from({ length: count }, (_, index) =>
          objective(`objective-${index}`),
        ),
        reward: {},
      },
    });

  it("allows three to seven", () => {
    expect(messages(daily(3))).not.toContain(COUNT_MESSAGE);
    expect(messages(daily(7))).not.toContain(COUNT_MESSAGE);
  });

  it("rejects other counts", () => {
    expect(messages(daily(2))).toContain(COUNT_MESSAGE);
    expect(messages(daily(8))).toContain(COUNT_MESSAGE);
  });

  it("leaves other quest types alone", () => {
    expect(messages(daily(2, "story"))).not.toContain(COUNT_MESSAGE);
  });
});

describe("raid boss health", () => {
  const CURRENT_MISSING = "Raid quests require current boss health";
  const CURRENT_TOO_HIGH = "Raid boss current health cannot exceed max health";
  const raid = (health: object) =>
    quest({
      questType: "raid",
      content: {
        objectives: [
          RaidObjective.parse({
            id: "boss",
            task: "open_raid",
            sector: 42,
            opponentAIs: [{ ids: ["boss"], number: 1 }],
          }),
        ],
        reward: {},
      },
      ...health,
    });

  it("accepts current health up to the maximum, including zero", () => {
    for (const current of [0, 100]) {
      const found = messages(
        raid({ raidBossMaxHealth: 100, raidBossCurrentHealth: current }),
      );
      expect(found).not.toContain(CURRENT_TOO_HIGH);
      expect(found).not.toContain(CURRENT_MISSING);
    }
  });

  it("rejects current health above the maximum", () => {
    expect(
      messages(raid({ raidBossMaxHealth: 100, raidBossCurrentHealth: 101 })),
    ).toContain(CURRENT_TOO_HIGH);
  });

  it("does not compare health while either side is missing", () => {
    for (const health of [
      { raidBossMaxHealth: 100 },
      { raidBossMaxHealth: 100, raidBossCurrentHealth: null },
      { raidBossCurrentHealth: 100 },
      { raidBossMaxHealth: null, raidBossCurrentHealth: 100 },
    ]) {
      expect(messages(raid(health))).not.toContain(CURRENT_TOO_HIGH);
    }
    expect(messages(raid({ raidBossMaxHealth: 100 }))).toContain(CURRENT_MISSING);
  });
});
