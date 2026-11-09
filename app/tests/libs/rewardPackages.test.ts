import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ADDITIONAL_MISSION_REWARD_MULTIPLIER,
  QuestRewardMetrics,
} from "@/drizzle/constants";
import { dataRouter } from "@/routers/data";
import { collapseRewards } from "@/libs/rewards";
import { getRewardArray } from "@/libs/objectives";
import { masteryQuestTemplates } from "../setup/mastery";
import { rewardOwnership, rewardUser as makeUser } from "../setup/quest";
import { resolverOf } from "../setup/testDatabase";
import { QuestValidator, SimpleObjective } from "@/validators/objectives";
import { villageMissionContentError } from "@/validators/villageMission";
import { getReward, postProcessRewards } from "@/libs/quest/rewards";
import {
  buildRewardChoiceCards,
  getUnavailableRewardCards,
  maxRewardPicks,
  requiredRewardPicks,
  rewardFromChoiceCards,
  toggleRewardPick,
  validateRewardPicks,
  verifyRewardChoiceForSave,
  validateQuestRewardPackages,
} from "@/libs/rewardChoice";
import {
  QuestReward,
  RewardNodeValidator,
  RewardPackageValidator,
} from "@/validators/rewardPackages";
import { hasMasteryPromotion, hasReward, ObjectiveReward } from "@/validators/rewards";
import type { QuestContentType } from "@/validators/objectives";

/** Create a normalized snapshot with distinct attachment and source identities. */
const packageReward = (id: string, data: object) => ({
  id,
  packageId: `source-${id}`,
  name: `Package ${id}`,
  description: "",
  rewards: ObjectiveReward.parse(data),
});
const ownership = rewardOwnership();
// These calculation tests supply a query stub and exercise the resolver without Redis middleware.
const questRewardStatistics = resolverOf(dataRouter.getQuestRewardStatistics);

// Exercise the editor's actual copy handler, including the payload it sends to validation.
const copyExpression = readFileSync(
  new URL(
    "../../src/app/[shell]/manual/quest/edit/[questid]/page.tsx",
    import.meta.url,
  ),
  "utf8",
).match(/  const copyObjective = ([\s\S]*?\n  };)/)?.[1];
if (!copyExpression) throw new Error("Quest objective copy handler was not found");
const { Transpiler } = (
  globalThis as unknown as {
    Bun: {
      Transpiler: new (options: {
        loader: "ts";
      }) => { transformSync: (source: string) => string };
    };
  }
).Bun;
const copyJavascript =
  new Transpiler({ loader: "ts" }).transformSync(`const copy = ${copyExpression};`) +
  "\nreturn copy;";
/** Execute the actual page copy action with deterministic ids and capture insertion/selection. */
const copyUsingEditor = (
  objectives: QuestContentType["objectives"],
  isUpdating = false,
  index = 0,
): { objectives: QuestContentType["objectives"]; selected: string | null } => {
  let next = objectives;
  let selected: string | null = null;
  let serial = 0;
  const copy = new Function(
    "objectives",
    "isUpdating",
    "nanoid",
    "setObjectives",
    "setSelectedObjectiveId",
    copyJavascript,
  )(
    objectives,
    isUpdating,
    () => `copy-${++serial}`,
    (value: typeof objectives) => {
      next = value;
    },
    (id: string) => {
      selected = id;
    },
  ) as (idx: number) => void;
  copy(index);
  return { objectives: next, selected };
};

describe("reward packages", () => {
  it("keeps repeated reward nodes as distinct choices and grants only the selected payload", () => {
    const reward = QuestReward.parse({
      reward_packages: [
        { id: "node-a", name: "Currency", rewards: { reward_money: 50 } },
        { id: "node-b", name: "Currency", rewards: { reward_money: 100 } },
      ],
    });
    const cards = buildRewardChoiceCards(reward);
    expect(cards.map((card) => card.id)).toEqual([
      "reward_package:node-a",
      "reward_package:node-b",
    ]);
    expect(rewardFromChoiceCards([cards[1]!]).reward_money).toBe(100);
    const content: QuestContentType = {
      reward,
      rewardMode: "choose",
      rewardPickCount: 1,
      objectives: [],
      sceneBackground: "",
      sceneCharacters: [],
    };
    expect(verifyRewardChoiceForSave(content).check).toBe(true);
    expect(
      validateQuestRewardPackages(
        content,
        { ...content, reward: QuestReward.parse({}) },
        [],
        "HEAD_CONTENT",
      ),
    ).toBeNull();
    reward.reward_packages![0]!.rewards.reward_reputation = 10;
    expect(
      validateQuestRewardPackages(
        { ...content, reward },
        { ...content, reward: QuestReward.parse({}) },
        [],
        "CONTENT",
      ),
    ).toBe("Package reputation must match its approved snapshot");
  });

  it("validates and previews pet-only rewards and preserves direct and packaged choices", () => {
    expect(ObjectiveReward.safeParse({ reward_pet_experience: -1 }).success).toBe(
      false,
    );
    expect(ObjectiveReward.safeParse({ reward_pet_experience: Infinity }).success).toBe(
      false,
    );
    const reward = QuestReward.parse({
      reward_pet_experience: "100",
      reward_packages: [packageReward("pet", { reward_pet_experience: 50 })],
    });
    expect(hasReward(ObjectiveReward.parse({ reward_pet_experience: 100 }))).toBe(true);
    expect(getRewardArray(reward)).toEqual(["150 pet experience"]);
    expect(getReward(makeUser({ reward }), "q1").rewards).toMatchObject({
      reward_exp: 0,
      reward_pet_experience: 150,
    });
    const choice = getReward(makeUser({ reward, rewardMode: "choose" }), "q1");
    expect(choice.rewards.reward_pet_experience ?? 0).toBe(0);
    expect(choice.rewardChoice?.cards).toHaveLength(2);
    for (const card of choice.rewardChoice!.cards) {
      const payout = postProcessRewards(rewardFromChoiceCards([card]));
      expect(payout.reward_exp).toBe(0);
      expect(payout.reward_pet_experience).toBe(
        card.field === "reward_package" ? 50 : 100,
      );
    }
  });

  it("aggregates objective pet XP and scales reduced missions and frozen choices", () => {
    const reward = QuestReward.parse({ reward_pet_experience: 100 });
    const objective = SimpleObjective.parse({
      id: "pet-objective",
      task: "user_level",
      value: 1,
      reward_pet_experience: 50,
    });
    expect(
      getReward(makeUser({ reward, objectives: [objective] }), "q1").rewards
        .reward_pet_experience,
    ).toBe(150);
    const user = makeUser({ reward, rewardMode: "choose" });
    user.dailyMissions = 1000;
    const choice = getReward(user, "q1");
    expect(choice.rewardChoice?.cards).toMatchObject([
      {
        field: "reward_pet_experience",
        amount: 100 * ADDITIONAL_MISSION_REWARD_MULTIPLIER,
      },
    ]);
  });

  it("grants combined snapshots and leaves the source untouched", () => {
    const reward = QuestReward.parse({
      reward_money: 10,
      reward_packages: [
        packageReward("a", { reward_money: 100 }),
        packageReward("b", {
          reward_money: 200,
          reward_items: [{ ids: ["item"], number: 100, quantity: 3 }],
        }),
      ],
    });
    const before = structuredClone(reward);
    const result = getReward(makeUser({ reward }), "q1");
    expect(result.rewards.reward_money).toBe(310);
    expect(result.rewards.reward_items).toEqual(["item", "item", "item"]);
    expect(reward).toEqual(before);
  });
  it("offers each package as one frozen bundle with its item chance", () => {
    const reward = QuestReward.parse({
      reward_packages: [
        packageReward("a", {
          reward_money: 100,
          reward_exp: 50,
          reward_items: [{ ids: ["item"], number: 0, quantity: 4 }],
        }),
        packageReward("b", { reward_money: 200 }),
      ],
    });
    const result = getReward(makeUser({ reward, rewardMode: "choose" }), "q1");
    expect(result.rewards.reward_money).toBe(0);
    expect(result.rewardChoice?.cards.length).toBe(2);
    const cards = result.rewardChoice!.cards;
    expect(cards[0]?.field).toBe("reward_package");
    const selected = validateRewardPicks(result.rewardChoice!, [cards[0]!.id]);
    expect(selected.success).toBe(true);
    const payout = postProcessRewards(rewardFromChoiceCards([cards[0]!]));
    expect(payout.reward_money).toBe(100);
    expect(payout.reward_exp).toBe(50);
    expect(payout.reward_items).toEqual([]);
    expect(
      verifyRewardChoiceForSave({ reward, rewardMode: "choose", rewardPickCount: 1 })
        .check,
    ).toBe(true);
  });
  it("keeps a partially owned bundle usable, but blocks an entirely owned one", () => {
    const owner = { ...ownership, jutsuIds: new Set(["known"]) };
    const cards = buildRewardChoiceCards(
      QuestReward.parse({
        reward_packages: [
          packageReward("owned", { reward_jutsus: ["known"] }),
          packageReward("mixed", { reward_jutsus: ["known"], reward_money: 100 }),
        ],
      }),
    );
    const blocked = getUnavailableRewardCards(cards, owner);
    expect(blocked.has(cards[0]!.id)).toBe(true);
    expect(blocked.has(cards[1]!.id)).toBe(false);
    expect(requiredRewardPicks({ cards, pickCount: 2 }, blocked)).toBe(1);
  });
  it("blocks an entire promotion bundle unless the player holds its predecessor rank", () => {
    const cards = buildRewardChoiceCards(
      QuestReward.parse({
        reward_packages: [
          packageReward("ninjutsu", {
            reward_mastery_stat: "ninjutsuMastery",
            reward_mastery_rank: "ADEPT",
            reward_money: 100,
          }),
          packageReward("genjutsu", {
            reward_mastery_stat: "genjutsuMastery",
            reward_mastery_rank: "ADEPT",
          }),
          packageReward("money", { reward_money: 50 }),
        ],
      }),
    );
    const choice = { id: "promotion-offer", cards, pickCount: 2 };
    for (const rank of ["NONE", "NOVICE", "ADEPT", "MASTER"] as const) {
      const owner = {
        ...ownership,
        masteryRanks: { ninjutsuMastery: rank, genjutsuMastery: "NOVICE" as const },
      };
      const blocked = getUnavailableRewardCards(cards, owner);
      expect(blocked.has(cards[0]!.id)).toBe(rank !== "NOVICE");
      expect(blocked.has(cards[1]!.id)).toBe(false);
      expect(blocked.has(cards[2]!.id)).toBe(false);
      expect(requiredRewardPicks(choice, blocked)).toBe(2);
      expect(
        validateRewardPicks(choice, [cards[0]!.id, cards[2]!.id], blocked).success,
      ).toBe(rank === "NOVICE");
      expect(
        validateRewardPicks(choice, [cards[1]!.id, cards[2]!.id], blocked).success,
      ).toBe(true);
      if (rank !== "NOVICE")
        expect(blocked.get(cards[0]!.id)).toContain("previous mastery rank");
    }
    const blocked = getUnavailableRewardCards(cards, ownership);
    expect(requiredRewardPicks(choice, blocked)).toBe(1);
    expect(validateRewardPicks(choice, [cards[2]!.id], blocked).success).toBe(true);
    const noviceCards = buildRewardChoiceCards(
      QuestReward.parse({
        reward_packages: [
          packageReward("novice", {
            reward_mastery_stat: "ninjutsuMastery",
            reward_mastery_rank: "NOVICE",
          }),
        ],
      }),
    );
    expect(getUnavailableRewardCards(noviceCards, ownership).size).toBe(0);
  });
  it("restricts sage mode selection across direct cards and bundles", () => {
    const cards = buildRewardChoiceCards(
      QuestReward.parse({
        reward_sage_modes: ["sage"],
        reward_packages: [
          packageReward("a", { reward_sage_modes: ["other"], reward_money: 50 }),
        ],
        reward_money: 10,
      }),
    );
    const picks = validateRewardPicks(
      { id: "choice", cards, pickCount: 2 },
      cards.filter((card) => card.field !== "reward_money").map((card) => card.id),
    );
    expect(picks.success).toBe(false);
  });
  it("selects only one eligible mastery promotion in either package order", () => {
    const promotions = [
      packageReward("ninjutsu", {
        reward_mastery_stat: "ninjutsuMastery",
        reward_mastery_rank: "ADEPT",
        reward_money: 100,
      }),
      packageReward("genjutsu", {
        reward_mastery_stat: "genjutsuMastery",
        reward_mastery_rank: "ADEPT",
        reward_money: 200,
      }),
    ];
    const owner = {
      ...ownership,
      masteryRanks: {
        ninjutsuMastery: "NOVICE" as const,
        genjutsuMastery: "NOVICE" as const,
      },
    };
    for (const packages of [promotions, [...promotions].reverse()]) {
      const reward = QuestReward.parse({
        reward_money: 10,
        reward_exp: 20,
        reward_packages: packages,
      });
      const cards = buildRewardChoiceCards(reward);
      const choice = { id: "multi-promotion", cards, pickCount: 2 };
      const blocked = getUnavailableRewardCards(cards, owner);
      const ids = cards
        .filter((card) => card.field === "reward_package")
        .map((card) => card.id);
      expect(blocked.size).toBe(0);
      expect(requiredRewardPicks(choice, blocked)).toBe(2);
      expect(
        verifyRewardChoiceForSave({ reward, rewardMode: "choose", rewardPickCount: 2 })
          .check,
      ).toBe(true);
      expect(validateRewardPicks(choice, ids, blocked)).toEqual({
        success: false,
        message: "Only one mastery promotion can be picked",
      });
      expect(toggleRewardPick([ids[0]!, "reward_money"], ids[1]!, 2, cards)).toEqual([
        ids[1]!,
        "reward_money",
      ]);
      const picks = validateRewardPicks(choice, [ids[0]!, "reward_money"], blocked);
      expect(picks.success).toBe(true);
      const payout = rewardFromChoiceCards(picks.success ? picks.cards : []);
      expect(payout.reward_mastery_stat).toBe(packages[0]!.rewards.reward_mastery_stat);
      expect(payout.reward_mastery_rank).toBe("ADEPT");
      expect(payout.reward_money).toBe(packages[0]!.rewards.reward_money + 10);
    }
    const reward = QuestReward.parse({ reward_money: 10, reward_packages: promotions });
    expect(
      verifyRewardChoiceForSave({ reward, rewardMode: "choose", rewardPickCount: 2 })
        .check,
    ).toBe(false);
    const cards = buildRewardChoiceCards(
      QuestReward.parse({ reward_packages: promotions }),
    );
    const legacy = { id: "legacy-two-promotion", cards, pickCount: 2 };
    expect(requiredRewardPicks(legacy)).toBe(1);
    expect(validateRewardPicks(legacy, [cards[0]!.id]).success).toBe(true);
    expect(toggleRewardPick([cards[0]!.id], cards[1]!.id, 1, cards)).toEqual([
      cards[1]!.id,
    ]);
  });
  it("counts and toggles overlapping sage and mastery bundles coherently", () => {
    const cards = buildRewardChoiceCards(
      QuestReward.parse({
        reward_money: 10,
        reward_packages: [
          packageReward("both", {
            reward_sage_modes: ["toad"],
            reward_mastery_stat: "ninjutsuMastery",
            reward_mastery_rank: "ADEPT",
          }),
          packageReward("mastery", {
            reward_mastery_stat: "genjutsuMastery",
            reward_mastery_rank: "ADEPT",
          }),
          packageReward("sage", { reward_sage_modes: ["snake"] }),
        ],
      }),
    );
    const [money, both, mastery, sage] = cards;
    expect(maxRewardPicks(cards)).toBe(3);
    expect(maxRewardPicks([money!, both!, mastery!])).toBe(2);
    expect(maxRewardPicks([money!, both!, sage!])).toBe(2);
    expect(maxRewardPicks([both!, { ...both!, id: "second-both" }])).toBe(1);
    const choice = { id: "overlap", cards, pickCount: 2 };
    expect(validateRewardPicks(choice, [mastery!.id, sage!.id]).success).toBe(true);
    expect(validateRewardPicks(choice, [both!.id, money!.id]).success).toBe(true);
    expect(validateRewardPicks(choice, [both!.id, mastery!.id]).success).toBe(false);
    expect(validateRewardPicks(choice, [both!.id, sage!.id]).success).toBe(false);
    expect(toggleRewardPick([mastery!.id, sage!.id], both!.id, 2, cards)).toEqual([
      both!.id,
    ]);
    expect(
      toggleRewardPick([mastery!.id, money!.id, sage!.id], both!.id, 3, cards),
    ).toEqual([both!.id, money!.id]);
    expect(toggleRewardPick([both!.id, money!.id], mastery!.id, 2, cards)).toEqual([
      mastery!.id,
      money!.id,
    ]);
    expect(toggleRewardPick([both!.id, money!.id], sage!.id, 2, cards)).toEqual([
      sage!.id,
      money!.id,
    ]);
  });
  it("allows approved reputation snapshots and rejects amount tampering", () => {
    const pack = packageReward("a", { reward_reputation: 5 });
    const content = {
      reward: QuestReward.parse({ reward_packages: [pack] }),
      objectives: [],
      sceneBackground: "",
      sceneCharacters: [],
    } satisfies QuestContentType;
    const source = [
      {
        id: pack.packageId,
        name: pack.name,
        description: "",
        rewards: pack.rewards,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const empty = { ...content, reward: QuestReward.parse({}) };
    expect(
      validateQuestRewardPackages(content, empty, source, "HEAD_CONTENT"),
    ).toBeNull();
    const tampered = structuredClone(content);
    tampered.reward.reward_packages![0]!.rewards.reward_reputation = 500;
    expect(
      validateQuestRewardPackages(tampered, empty, source, "HEAD_CONTENT"),
    ).toContain("approved snapshot");
    source[0]!.rewards = ObjectiveReward.parse({ reward_reputation: 9 });
    expect(
      validateQuestRewardPackages(content, content, source, "HEAD_CONTENT"),
    ).toBeNull();
  });
  it("omits scalar bundles reduced to zero at completion", () => {
    const user = makeUser({
      reward: QuestReward.parse({
        reward_packages: [
          packageReward("a", { reward_money: 1 }),
          packageReward("b", { reward_money: 2 }),
        ],
      }),
      rewardMode: "choose",
    });
    (user as unknown as { dailyMissions: number }).dailyMissions = 1000;
    const result = getReward(user, "q1");
    expect(result.rewardChoice).toBeNull();
    const empty = {
      id: "empty",
      field: "reward_package" as const,
      amount: 1,
      rewards: ObjectiveReward.parse({}),
    };
    expect(getUnavailableRewardCards([empty], ownership).has("empty")).toBe(true);
  });
  it("grants objective packages alongside completion rewards", () => {
    const objective = SimpleObjective.parse({
      id: "objective",
      task: "user_level",
      value: 1,
      reward_packages: [
        packageReward("objective", {
          reward_money: 40,
          reward_items: [{ ids: ["item"], number: 100, quantity: 2 }],
        }),
      ],
    });
    const result = getReward(
      makeUser({
        reward: ObjectiveReward.parse({ reward_money: 20 }),
        objectives: [objective],
      }),
      "q1",
    );
    expect(result.rewards.reward_money).toBe(60);
    expect(result.rewards.reward_items).toEqual(["item", "item"]);
  });
  it("carries material drops from direct-only objectives", () => {
    const objective = SimpleObjective.parse({
      id: "objective",
      task: "user_level",
      value: 1,
      reward_hunter_items: true,
      reward_hunter_items_ids: ["hide"],
      reward_gathering_items: true,
      reward_gathering_items_ids: ["herb"],
    });
    const quiet = SimpleObjective.parse({
      id: "quiet",
      task: "user_level",
      value: 1,
      reward_money: 5,
    });
    const { rewards } = getReward(
      makeUser({
        reward: QuestReward.parse({ reward_gathering_items_ids: ["ore"] }),
        objectives: [objective, quiet],
      }),
      "q1",
    );
    expect(rewards).toMatchObject({
      reward_hunter_items: true,
      reward_hunter_items_ids: ["hide"],
      reward_gathering_items: true,
      reward_gathering_items_ids: ["ore", "herb"],
    });
  });
  it("matches mixed objective structural previews and preserves later objective ordering", () => {
    for (const [directRank, packageRank] of [
      ["CHUNIN", "JONIN"],
      ["JONIN", "CHUNIN"],
    ] as const) {
      const mixed = QuestReward.parse({
        reward_rank: directRank,
        reward_village_membership: "AKIKAZE",
        reward_money: 10,
        reward_packages: [
          packageReward("structural", {
            reward_rank: packageRank,
            reward_village_membership: "HYORIN",
            reward_money: 40,
            reward_items: [{ ids: ["item"], quantity: 2, number: 100 }],
          }),
        ],
      });
      const objective = SimpleObjective.parse({
        id: "objective",
        task: "user_level",
        value: 1,
        successDescription: "Objective complete",
        ...mixed,
      });
      const before = structuredClone(objective);
      const result = getReward(
        makeUser(
          { reward: QuestReward.parse({ reward_money: 20 }), objectives: [objective] },
          "exam",
        ),
        "q1",
      );
      expect(getRewardArray(objective)).toContain("rank of jonin");
      expect(getRewardArray(objective)).toContain("village membership of Hyorin");
      expect(result.rewards).toMatchObject({
        reward_rank: "JONIN",
        reward_village_membership: "HYORIN",
        reward_money: 70,
        reward_items: ["item", "item"],
      });
      expect(result.notifications).toContain("Objective complete");
      expect(objective).toEqual(before);
      const completion = getReward(
        makeUser({ reward: mixed, objectives: [] }, "exam"),
        "q1",
      );
      expect(result.rewards.reward_rank).toBe(completion.rewards.reward_rank);
      expect(result.rewards.reward_village_membership).toBe(
        completion.rewards.reward_village_membership,
      );
      const later = SimpleObjective.parse({
        id: "later",
        task: "user_level",
        value: 1,
        reward_rank: "CHUNIN",
        reward_village_membership: "AKIKAZE",
      });
      const ordered = getReward(
        makeUser(
          { reward: QuestReward.parse({}), objectives: [objective, later] },
          "exam",
        ),
        "q1",
      );
      expect(ordered.rewards).toMatchObject({
        reward_rank: "CHUNIN",
        reward_village_membership: "AKIKAZE",
        reward_money: 50,
      });
    }
  });
  it("copies objective package identities while preserving every saved reward and source", () => {
    const objective = SimpleObjective.parse({
      id: "original",
      task: "user_level",
      value: 1,
      reward_money: 10,
      reward_packages: [
        packageReward("a", {
          reward_money: 100,
          reward_reputation: 5,
          reward_items: [{ ids: ["item"], number: 35, quantity: 3 }],
        }),
        packageReward("b", { reward_exp: 50 }),
      ],
    });
    const before = structuredClone(objective);
    const copied = copyUsingEditor([objective]);
    const copy = copied.objectives[1]!;
    expect(copied.objectives).toHaveLength(2);
    expect(copied.selected).toBe(copy.id);
    expect(copy.id).not.toBe(objective.id);
    expect(copied.objectives[0]).toEqual(before);
    expect<QuestContentType["objectives"][number]>({
      ...copy,
      id: objective.id,
      reward_packages: copy.reward_packages?.map((pack, index) => ({
        ...pack,
        id: objective.reward_packages![index]!.id,
      })),
    }).toEqual(before);
    const ids = copied.objectives.flatMap(
      (obj) => obj.reward_packages?.map((pack) => pack.id) ?? [],
    );
    expect(new Set(ids).size).toBe(4);
    const existing = {
      reward: QuestReward.parse({}),
      objectives: [objective],
      sceneBackground: "",
      sceneCharacters: [],
    };
    const content = { ...existing, objectives: copied.objectives };
    const sources = objective.reward_packages!.map((pack) => ({
      id: pack.packageId!,
      name: pack.name,
      description: pack.description,
      rewards: pack.rewards,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    expect(
      validateQuestRewardPackages(content, existing, sources, "HEAD_CONTENT"),
    ).toBeNull();
    expect(getReward(makeUser(content), "q1").rewards.reward_money).toBe(220);
    expect(getReward(makeUser(content), "q1").rewards.reward_reputation).toBe(10);
  });
  it("preserves direct objective copies and refuses copies while saving or without a source objective", () => {
    const objective = SimpleObjective.parse({
      id: "direct",
      task: "user_level",
      value: 1,
      reward_money: 40,
    });
    const copied = copyUsingEditor([objective]);
    expect({ ...copied.objectives[1], id: objective.id }).toEqual(objective);
    expect(copyUsingEditor([objective], true)).toEqual({
      objectives: [objective],
      selected: null,
    });
    expect(copyUsingEditor([objective], false, 3)).toEqual({
      objectives: [objective],
      selected: null,
    });
  });
  for (const role of ["CONTENT", "HEAD_CONTENT", "HEAD_EVENT"] as const) {
    it(`preserves ${role}'s saved reputation approval on editable copies after catalog changes or deletion`, () => {
      const pack = packageReward("saved", { reward_money: 100, reward_reputation: 5 });
      const objective = SimpleObjective.parse({
        id: "original",
        task: "user_level",
        value: 1,
        reward_packages: [pack],
      });
      const existing = {
        reward: QuestReward.parse({}),
        objectives: [objective],
        sceneBackground: "",
        sceneCharacters: [],
      };
      const content = {
        ...existing,
        objectives: copyUsingEditor([objective]).objectives,
      };
      const source = [
        {
          id: pack.packageId,
          name: "Updated",
          description: "Updated",
          rewards: ObjectiveReward.parse({ reward_money: 200, reward_reputation: 9 }),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const unchanged = structuredClone(existing);
      expect(validateQuestRewardPackages(content, existing, source, role)).toBeNull();
      expect(validateQuestRewardPackages(content, existing, [], role)).toBeNull();
      expect(existing).toEqual(unchanged);
      const edited = structuredClone(content);
      const editableCopy = edited.objectives[1]!.reward_packages![0]!;
      edited.objectives[1]!.reward_packages![0] = {
        ...editableCopy,
        name: "Renamed copy",
        description: "Customized description",
        rewards: { ...editableCopy.rewards, reward_money: 125 },
      };
      expect(validateQuestRewardPackages(edited, existing, source, role)).toBeNull();
      expect(validateQuestRewardPackages(edited, existing, [], role)).toBeNull();
      const tampered = structuredClone(content);
      const copy = tampered.objectives[1]!.reward_packages![0]!;
      tampered.objectives[1]!.reward_packages![0] = {
        ...copy,
        rewards: { ...copy.rewards, reward_reputation: 500 },
      };
      expect(validateQuestRewardPackages(tampered, existing, source, role)).toContain(
        "approved snapshot",
      );
      tampered.objectives[1]!.reward_packages![0]!.packageId = "unapproved-source";
      expect(validateQuestRewardPackages(tampered, existing, source, role)).toContain(
        "no longer exists",
      );
      const duplicate = structuredClone(content);
      duplicate.objectives[1]!.reward_packages![0]!.id = pack.id;
      expect(validateQuestRewardPackages(duplicate, existing, source, role)).toContain(
        "unique id",
      );
      const changedSaved = structuredClone(existing);
      changedSaved.objectives[0]!.reward_packages![0]!.rewards.reward_reputation = 9;
      expect(
        validateQuestRewardPackages(changedSaved, existing, source, role),
      ).toContain("approved snapshot");
    });
  }
  it("allows reputation authors to edit copied snapshots after source deletion but rejects unknown sources", () => {
    const pack = packageReward("deleted", { reward_reputation: 5 });
    const objective = SimpleObjective.parse({
      id: "original",
      task: "user_level",
      value: 1,
      reward_packages: [pack],
    });
    const existing = {
      reward: QuestReward.parse({}),
      objectives: [objective],
      sceneBackground: "",
      sceneCharacters: [],
    };
    const content = {
      ...existing,
      objectives: copyUsingEditor([objective]).objectives,
    };
    const copy = content.objectives[1]!.reward_packages![0]!;
    content.objectives[1]!.reward_packages![0] = {
      ...copy,
      rewards: { ...copy.rewards, reward_reputation: 7 },
    };
    const savedEdit = {
      ...existing,
      objectives: [
        {
          ...objective,
          reward_packages: [
            { ...content.objectives[1]!.reward_packages![0]!, id: pack.id },
          ],
        },
      ],
    };
    expect(
      validateQuestRewardPackages(savedEdit, existing, [], "CONTENT-ADMIN"),
    ).toBeNull();
    expect(
      validateQuestRewardPackages(content, existing, [], "CONTENT-ADMIN"),
    ).toBeNull();
    expect(
      validateQuestRewardPackages(content, existing, [], "HEAD_CONTENT"),
    ).toContain("no longer exists");
    content.objectives[1]!.reward_packages![0]!.packageId = "unknown-source";
    expect(
      validateQuestRewardPackages(content, existing, [], "CONTENT-ADMIN"),
    ).toContain("no longer exists");
  });
  for (const metric of QuestRewardMetrics) {
    it(`includes direct, packaged and mixed ${metric} totals in the balance endpoint`, async () => {
      /** Build an immediately complete objective with direct or packaged metric rewards. */
      const objective = (data: object) =>
        SimpleObjective.parse({
          id: "objective",
          task: "user_level",
          value: 1,
          ...data,
        });
      const contents = [
        {
          reward: QuestReward.parse({ [metric]: 100 }),
          objectives: [objective({ [metric]: 40 })],
        },
        {
          reward: QuestReward.parse({
            reward_packages: [packageReward("completion", { [metric]: 100 })],
          }),
          objectives: [
            objective({
              reward_packages: [packageReward("objective", { [metric]: 40 })],
            }),
          ],
        },
        {
          reward: QuestReward.parse({
            [metric]: 30,
            reward_packages: [packageReward("completion", { [metric]: 70 })],
          }),
          objectives: [
            objective({
              [metric]: 10,
              reward_packages: [packageReward("objective", { [metric]: 30 })],
            }),
          ],
        },
        {
          reward: QuestReward.parse({}),
          objectives: [
            objective({
              reward_packages: [packageReward("objective", { [metric]: 40 })],
            }),
          ],
        },
      ];
      const rows = contents.map((content, index) => ({
        id: `quest-${index}`,
        name: "Balance",
        questRank: "D",
        questType: "mission",
        requiredLevel: 1,
        content,
      }));
      let reads = 0;
      const ctx = {
        drizzle: {
          select: () => {
            reads++;
            return { from: () => ({ where: async () => rows }) };
          },
        },
      };
      const before = structuredClone(rows);
      const statistics = await questRewardStatistics({
        ctx,
        input: { reward: metric, questTypes: ["mission"] },
      });
      expect(reads).toBe(1);
      expect(statistics.map((entry) => entry.value)).toEqual([140, 140, 140, 40]);
      for (const [index, content] of contents.entries()) {
        expect(statistics[index]!.value).toBe(
          getReward(makeUser(content), "q1").rewards[metric],
        );
      }
      expect(rows).toEqual(before);
    });
  }
  it("keeps balance totals as all offered rewards for choice quests and tolerates sparse legacy rewards", async () => {
    const content = {
      reward: QuestReward.parse({
        reward_money: 10,
        reward_packages: [
          packageReward("a", { reward_money: 100 }),
          packageReward("b", { reward_money: 60 }),
        ],
      }),
      rewardMode: "choose",
      rewardPickCount: 1,
      objectives: [
        SimpleObjective.parse({
          id: "objective",
          task: "user_level",
          value: 1,
          reward_packages: [packageReward("objective", { reward_money: 40 })],
        }),
      ],
    };
    const rows = [
      { id: "choice", content },
      {
        id: "legacy",
        content: { reward: { reward_money: 100 }, objectives: [{ reward_money: 40 }] },
      },
      { id: "empty", content: {} },
    ];
    const statistics = await questRewardStatistics({
      ctx: {
        drizzle: { select: () => ({ from: () => ({ where: async () => rows }) }) },
      },
      input: { reward: "reward_money" },
    });
    expect(statistics.map((entry) => entry.value)).toEqual([210, 140, 0]);
    const result = getReward(makeUser(content), "q1");
    expect(result.rewards.reward_money).toBe(40);
    expect(result.rewardChoice?.cards).toHaveLength(3);
    expect(
      result.rewards.reward_money +
        rewardFromChoiceCards(result.rewardChoice!.cards).reward_money,
    ).toBe(210);
  });
  it("validates custom nodes against existing reward fields", () => {
    expect(
      RewardNodeValidator.safeParse({
        name: "Currency",
        fields: ["reward_money", "reward_reputation"],
      }).success,
    ).toBe(true);
    expect(
      RewardNodeValidator.safeParse({ name: "Invalid", fields: ["arbitrary"] }).success,
    ).toBe(false);
    expect(
      RewardNodeValidator.safeParse({
        name: "Duplicates",
        fields: ["reward_money", "reward_money"],
      }).success,
    ).toBe(false);
  });
});

describe("package validation and merging", () => {
  it("rejects empty packages and incomplete mastery pairs", () => {
    expect(
      RewardPackageValidator.safeParse({ name: "Empty", rewards: {} }).success,
    ).toBe(false);
    const template = masteryQuestTemplates()[0]!;
    for (const rewards of [
      { reward_mastery_rank: "ADEPT" },
      { reward_mastery_stat: "ninjutsuMastery" },
    ]) {
      expect(
        QuestValidator.safeParse({
          ...template,
          content: { ...template.content, reward: ObjectiveReward.parse(rewards) },
        }).success,
      ).toBe(false);
    }
  });
  it("keeps the highest current rank when packages are combined", () => {
    expect(
      collapseRewards([
        ObjectiveReward.parse({ reward_rank: "JONIN" }),
        ObjectiveReward.parse({ reward_rank: "ELDER" }),
      ]).reward_rank,
    ).toBe("ELDER");
    expect(
      collapseRewards([
        ObjectiveReward.parse({ reward_rank: "ELDER" }),
        ObjectiveReward.parse({ reward_rank: "GENIN" }),
      ]).reward_rank,
    ).toBe("ELDER");
    expect(
      collapseRewards([
        ObjectiveReward.parse({ reward_rank: "ELITE JONIN" }),
        ObjectiveReward.parse({ reward_rank: "ELDER" }),
      ]).reward_rank,
    ).toBe("ELITE JONIN");
    expect(
      collapseRewards([
        ObjectiveReward.parse({ reward_rank: "ELDER" }),
        ObjectiveReward.parse({ reward_rank: "ELITE JONIN" }),
      ]).reward_rank,
    ).toBe("ELITE JONIN");
  });
  it("resolves Village Mission token packages and rejects unsupported bundle contents", () => {
    const content = {
      reward: QuestReward.parse({
        reward_packages: [packageReward("tokens", { reward_tokens: 50 })],
      }),
      objectives: [{ id: "pvp", task: "pvp_kills", description: "Win", value: 1 }],
    };
    expect(villageMissionContentError(content, false)).toBeNull();
    content.reward.reward_packages![0]!.rewards.reward_money = 1;
    expect(villageMissionContentError(content, false)).toContain(
      "only contain village tokens",
    );
  });
});

describe("hasMasteryPromotion", () => {
  it("needs both a stat and a rank", () => {
    const stat = { reward_mastery_stat: "ninjutsuMastery" } as const;
    expect(hasMasteryPromotion({ ...stat, reward_mastery_rank: "NONE" })).toBe(false);
    expect(hasMasteryPromotion(stat)).toBe(false);
    expect(
      hasMasteryPromotion({ reward_mastery_stat: "None", reward_mastery_rank: "NONE" }),
    ).toBe(false);
  });

  it("keeps an earlier promotion when a later reward names no rank", () => {
    const promotion = ObjectiveReward.parse({
      reward_mastery_stat: "ninjutsuMastery",
      reward_mastery_rank: "ADEPT",
    });
    const collapsed = collapseRewards([
      promotion,
      { ...promotion, reward_mastery_rank: "NONE" },
    ]);
    expect(collapsed.reward_mastery_rank).toBe("ADEPT");
  });
});
