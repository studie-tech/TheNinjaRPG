import { describe, expect, it } from "bun:test";
import { getExperienceTrackerTasks, getNewTrackers, getReward } from "@/libs/quest";
import {
  buildRewardChoiceCards,
  getFixedChoiceRewards,
  getRewardPickCount,
  getUnavailableRewardCards,
  isRewardChoiceQuest,
  REWARD_CHOICE_OWNED_REASON,
  REWARD_CHOICE_SAGE_EQUIPPED_REASON,
  type RewardChoiceOwnership,
  requiredRewardPicks,
  rewardFromChoiceCards,
  toggleRewardPick,
  validateRewardPicks,
  verifyRewardChoiceForSave,
} from "@/libs/rewardChoice";
import {
  ObjectiveReward,
  type PendingRewardChoice,
  type RewardChoiceCard,
} from "@/validators/rewards";

const reward = (input: Parameters<typeof ObjectiveReward.parse>[0]) =>
  ObjectiveReward.parse(input);

const offer = (pickCount: number, cardCount: number): PendingRewardChoice => ({
  id: "offer-1",
  pickCount,
  cards: Array.from({ length: cardCount }, (_, i) => ({
    id: `card-${i}`,
    field: "reward_money" as const,
    amount: 10 * (i + 1),
  })),
});

describe("buildRewardChoiceCards", () => {
  it("makes one card per scalar, per item id and per content id", () => {
    const cards = buildRewardChoiceCards(
      reward({
        reward_money: 500,
        reward_exp: 1000,
        reward_items: [
          { ids: ["tanto", "scroll"], number: 50, quantity: 2 },
          { ids: ["tanto"], number: 100, quantity: 1 },
        ],
        reward_jutsus: ["fireball", "fireball"],
        reward_badges: ["badge-1"],
      }),
    );
    expect(cards).toEqual([
      { id: "reward_money", field: "reward_money", amount: 500 },
      { id: "reward_exp", field: "reward_exp", amount: 1000 },
      {
        id: "reward_items:0:tanto",
        field: "reward_items",
        amount: 2,
        contentId: "tanto",
      },
      {
        id: "reward_items:0:scroll",
        field: "reward_items",
        amount: 2,
        contentId: "scroll",
      },
      {
        id: "reward_items:1:tanto",
        field: "reward_items",
        amount: 1,
        contentId: "tanto",
      },
      {
        id: "reward_jutsus:fireball",
        field: "reward_jutsus",
        amount: 1,
        contentId: "fireball",
      },
      { id: "reward_badges:badge-1", field: "reward_badges", amount: 1, contentId: "badge-1" },
    ]);
  });

  it("leaves structural rewards out of the cards and in the fixed part", () => {
    const full = reward({
      reward_money: 100,
      reward_rank: "CHUNIN",
      reward_village_membership: "SHIROHANA",
      reward_hunter_items: true,
      reward_hunter_items_ids: ["hide"],
    });
    expect(buildRewardChoiceCards(full).map((card) => card.id)).toEqual(["reward_money"]);
    const fixed = getFixedChoiceRewards(full);
    expect(fixed).toMatchObject({
      reward_money: 0,
      reward_rank: "CHUNIN",
      reward_village_membership: "SHIROHANA",
      reward_hunter_items: true,
      reward_hunter_items_ids: ["hide"],
    });
  });
});

describe("validateRewardPicks", () => {
  it("accepts exactly the configured number of offered cards", () => {
    const result = validateRewardPicks(offer(2, 4), ["card-3", "card-1"]);
    expect(result).toEqual({
      success: true,
      cards: [
        { id: "card-1", field: "reward_money", amount: 20 },
        { id: "card-3", field: "reward_money", amount: 40 },
      ],
    });
  });

  it("rejects too few, too many, duplicated and unknown picks", () => {
    expect(validateRewardPicks(offer(2, 4), ["card-1"]).success).toBe(false);
    expect(validateRewardPicks(offer(2, 4), ["card-0", "card-1", "card-2"]).success).toBe(
      false,
    );
    expect(validateRewardPicks(offer(2, 4), ["card-1", "card-1"]).success).toBe(false);
    expect(validateRewardPicks(offer(2, 4), ["card-1", "card-9"]).success).toBe(false);
  });

  it("requires every card when fewer cards than picks survive scaling", () => {
    expect(requiredRewardPicks(offer(3, 2))).toBe(2);
    expect(validateRewardPicks(offer(3, 2), ["card-0", "card-1"]).success).toBe(true);
    expect(validateRewardPicks(offer(3, 2), ["card-0"]).success).toBe(false);
  });
});

const contentCard = (
  field: "reward_jutsus" | "reward_bloodlines" | "reward_badges" | "reward_sage_modes",
  contentId: string,
): RewardChoiceCard => ({ id: `${field}:${contentId}`, field, amount: 1, contentId });

const ownership = (
  owned: Partial<Record<keyof Omit<RewardChoiceOwnership, "hasSageMode">, string[]>> = {},
  hasSageMode = false,
): RewardChoiceOwnership => ({
  jutsuIds: new Set(owned.jutsuIds),
  bloodlineIds: new Set(owned.bloodlineIds),
  badgeIds: new Set(owned.badgeIds),
  sageModeIds: new Set(owned.sageModeIds),
  hasSageMode,
});

describe("rewards the player cannot receive", () => {
  const cards = [
    { id: "reward_money", field: "reward_money" as const, amount: 100 },
    contentCard("reward_jutsus", "fireball"),
    contentCard("reward_bloodlines", "sharingan"),
    contentCard("reward_badges", "badge-1"),
    contentCard("reward_sage_modes", "toad"),
    contentCard("reward_sage_modes", "snake"),
  ];
  const choice = (pickCount: number): PendingRewardChoice => ({
    id: "offer-1",
    pickCount,
    cards,
  });

  it("marks owned jutsus, bloodlines, badges and rolled sage modes", () => {
    const unavailable = getUnavailableRewardCards(
      cards,
      ownership({
        jutsuIds: ["fireball"],
        bloodlineIds: ["sharingan"],
        badgeIds: ["badge-1"],
        sageModeIds: ["toad"],
      }),
    );
    expect(Object.fromEntries(unavailable)).toEqual({
      "reward_jutsus:fireball": REWARD_CHOICE_OWNED_REASON,
      "reward_bloodlines:sharingan": REWARD_CHOICE_OWNED_REASON,
      "reward_badges:badge-1": REWARD_CHOICE_OWNED_REASON,
      "reward_sage_modes:toad": REWARD_CHOICE_OWNED_REASON,
    });
  });

  it("marks every sage mode once one is equipped", () => {
    const unavailable = getUnavailableRewardCards(cards, ownership({}, true));
    expect([...unavailable.keys()]).toEqual([
      "reward_sage_modes:toad",
      "reward_sage_modes:snake",
    ]);
    expect(unavailable.get("reward_sage_modes:toad")).toBe(
      REWARD_CHOICE_SAGE_EQUIPPED_REASON,
    );
  });

  it("refuses an owned pick and keeps the count the player can still fill", () => {
    const unavailable = getUnavailableRewardCards(
      cards,
      ownership({ jutsuIds: ["fireball"] }),
    );
    const result = validateRewardPicks(
      choice(1),
      ["reward_jutsus:fireball"],
      unavailable,
    );
    expect(result).toEqual({
      success: false,
      message: `${REWARD_CHOICE_OWNED_REASON}: pick a different reward`,
    });
    expect(validateRewardPicks(choice(1), ["reward_money"], unavailable).success).toBe(
      true,
    );
  });

  it("shrinks the requirement to what can still be granted", () => {
    // money + bloodline + badge + one sage mode remain once the jutsu is owned.
    const someOwned = getUnavailableRewardCards(
      cards,
      ownership({ jutsuIds: ["fireball"] }),
    );
    expect(requiredRewardPicks(choice(5), someOwned)).toBe(4);
    const allOwned = getUnavailableRewardCards(
      [cards[1]!, cards[3]!],
      ownership({ jutsuIds: ["fireball"], badgeIds: ["badge-1"] }),
    );
    const ownedOffer = { id: "offer-2", pickCount: 1, cards: [cards[1]!, cards[3]!] };
    expect(requiredRewardPicks(ownedOffer, allOwned)).toBe(0);
    // Nothing is grantable, so an empty pick clears the offer instead of blocking it forever.
    expect(validateRewardPicks(ownedOffer, [], allOwned)).toEqual({
      success: true,
      cards: [],
    });
  });
});

describe("sage mode picks", () => {
  const sageOffer: PendingRewardChoice = {
    id: "offer-1",
    pickCount: 2,
    cards: [
      { id: "reward_money", field: "reward_money", amount: 100 },
      contentCard("reward_sage_modes", "toad"),
      contentCard("reward_sage_modes", "snake"),
    ],
  };

  it("allows at most one sage mode per pick", () => {
    expect(
      validateRewardPicks(sageOffer, ["reward_sage_modes:toad", "reward_sage_modes:snake"]),
    ).toEqual({ success: false, message: "Only one sage mode can be picked" });
    expect(
      validateRewardPicks(sageOffer, ["reward_money", "reward_sage_modes:snake"]).success,
    ).toBe(true);
  });

  it("counts several sage modes as one pickable reward", () => {
    expect(requiredRewardPicks({ ...sageOffer, pickCount: 3 })).toBe(2);
    const content = {
      reward: reward({ reward_money: 1, reward_sage_modes: ["toad", "snake", "slug"] }),
      rewardMode: "choose" as const,
    };
    expect(verifyRewardChoiceForSave({ ...content, rewardPickCount: 1 }).check).toBe(true);
    expect(verifyRewardChoiceForSave({ ...content, rewardPickCount: 2 }).check).toBe(false);
  });

  it("swaps the selected sage mode instead of adding a second one", () => {
    expect(
      toggleRewardPick(
        ["reward_sage_modes:toad"],
        "reward_sage_modes:snake",
        2,
        sageOffer.cards,
      ),
    ).toEqual(["reward_sage_modes:snake"]);
    expect(
      toggleRewardPick(
        ["reward_sage_modes:toad", "reward_money"],
        "reward_sage_modes:snake",
        2,
        sageOffer.cards,
      ),
    ).toEqual(["reward_sage_modes:snake", "reward_money"]);
  });
});

describe("getExperienceTrackerTasks", () => {
  it("emits one increment per granted profession experience", () => {
    expect(
      getExperienceTrackerTasks(
        reward({ reward_medical_experience: 30, reward_hunting_experience: 5, reward_exp: 9 }),
      ),
    ).toEqual([
      { task: "medical_experience_gained", increment: 30 },
      { task: "hunting_experience_gained", increment: 5 },
    ]);
    expect(getExperienceTrackerTasks(reward({ reward_exp: 100 }))).toEqual([]);
  });
});

describe("toggleRewardPick", () => {
  it("swaps the selection for single-pick offers", () => {
    expect(toggleRewardPick([], "a", 1)).toEqual(["a"]);
    expect(toggleRewardPick(["a"], "b", 1)).toEqual(["b"]);
    expect(toggleRewardPick(["a"], "a", 1)).toEqual([]);
  });

  it("stops adding once a multi-pick selection is full", () => {
    expect(toggleRewardPick(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(toggleRewardPick(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(toggleRewardPick(["a", "b"], "a", 2)).toEqual(["b"]);
  });
});

describe("rewardFromChoiceCards", () => {
  it("grants picked items guaranteed and sums scalars", () => {
    const granted = rewardFromChoiceCards([
      { id: "reward_money", field: "reward_money", amount: 300 },
      { id: "reward_items:0:tanto", field: "reward_items", amount: 2, contentId: "tanto" },
      { id: "reward_jutsus:fire", field: "reward_jutsus", amount: 1, contentId: "fire" },
    ]);
    expect(granted.reward_money).toBe(300);
    expect(granted.reward_items).toEqual([{ ids: ["tanto"], number: 100, quantity: 2 }]);
    expect(granted.reward_jutsus).toEqual(["fire"]);
    expect(granted.reward_exp).toBe(0);
  });
});

describe("reward mode helpers", () => {
  it("treats content without a mode as granting everything", () => {
    expect(isRewardChoiceQuest({})).toBe(false);
    expect(isRewardChoiceQuest({ rewardMode: "all" })).toBe(false);
    expect(isRewardChoiceQuest({ rewardMode: "choose" })).toBe(true);
  });

  it("clamps the pick count into the supported range", () => {
    expect(getRewardPickCount({})).toBe(1);
    expect(getRewardPickCount({ rewardPickCount: 0 })).toBe(1);
    expect(getRewardPickCount({ rewardPickCount: 9 })).toBe(5);
    expect(getRewardPickCount({ rewardPickCount: 3 })).toBe(3);
  });

  it("refuses to save a choose quest without more cards than picks", () => {
    const content = {
      reward: reward({ reward_money: 1, reward_exp: 1 }),
      rewardMode: "choose" as const,
    };
    expect(verifyRewardChoiceForSave({ ...content, rewardPickCount: 1 }).check).toBe(true);
    expect(verifyRewardChoiceForSave({ ...content, rewardPickCount: 2 }).check).toBe(false);
    expect(
      verifyRewardChoiceForSave({ ...content, rewardMode: "all", rewardPickCount: 5 }).check,
    ).toBe(true);
  });
});

describe("getReward with a reward choice", () => {
  const makeUser = (content: Record<string, unknown>, questType = "mission") =>
    ({
      userId: "u1",
      level: 50,
      rank: "JONIN",
      role: "USER",
      villageId: "v1",
      isOutlaw: false,
      bloodlineId: null,
      sector: 1,
      village: { id: "v1", sector: 1 },
      activeWars: [],
      completedQuests: [],
      dailyMissions: 0,
      senseiId: null,
      questData: [],
      userQuests: [
        {
          id: "uq-1",
          questId: "q1",
          completed: 0,
          previousAttempts: 0,
          previousCompletes: 0,
          quest: {
            id: "q1",
            name: "Quest",
            questType,
            hidden: false,
            consecutiveObjectives: false,
            maxAttempts: 10,
            maxCompletes: 10,
            content: {
              objectives: [],
              sceneBackground: "",
              sceneCharacters: [],
              ...content,
            },
          },
        },
      ],
    }) as unknown as Parameters<typeof getNewTrackers>[0];

  const questReward = {
    reward_money: 100,
    reward_exp: 50,
    reward_items: [{ ids: ["tanto"], number: 100, quantity: 1 }],
    reward_rank: "NONE",
  };

  it("grants everything and offers nothing for quests in the default mode", () => {
    const result = getReward(makeUser({ reward: questReward }), "q1");
    expect(result.resolved).toBe(true);
    expect(result.rewardChoice).toBeNull();
    expect(result.rewards.reward_money).toBe(100);
    expect(result.rewards.reward_items).toEqual(["tanto"]);
  });

  it("withholds the pickable rewards and freezes them as an offer", () => {
    const result = getReward(
      makeUser({ reward: questReward, rewardMode: "choose", rewardPickCount: 2 }),
      "q1",
    );
    expect(result.resolved).toBe(true);
    expect(result.rewards.reward_money).toBe(0);
    expect(result.rewards.reward_exp).toBe(0);
    expect(result.rewards.reward_items).toEqual([]);
    expect(result.rewardChoice).toMatchObject({
      pickCount: 2,
      cards: [
        { id: "reward_money", amount: 100 },
        { id: "reward_exp", amount: 50 },
        { id: "reward_items:0:tanto", amount: 1, contentId: "tanto" },
      ],
    });
  });

  it("applies the same scaling to the offer as to granted rewards", () => {
    const user = makeUser({ reward: questReward, rewardMode: "choose" });
    (user as unknown as { dailyMissions: number }).dailyMissions = 1000;
    const all = getReward(makeUser({ reward: questReward }), "q1");
    const reduced = getReward(user, "q1");
    const fullAmount = all.rewards.reward_money;
    const offered = reduced.rewardChoice?.cards.find((card) => card.id === "reward_money");
    expect(offered?.amount).toBeLessThan(fullAmount);
  });
});
