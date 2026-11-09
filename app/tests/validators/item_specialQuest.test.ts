import { describe, expect, it } from "bun:test";
import { nonCombatConsume } from "@/libs/item";
import {
  getTagSchema,
  ItemValidator,
  NonCombatQuestTag,
  tagTypes,
} from "@/validators/combat";
import { QuestValidator } from "@/validators/objectives";
import { validItemInput } from "../setup/items";

const validItem = validItemInput();

const effect = NonCombatQuestTag.parse({ questId: "special-quest" });
const scroll = {
  ...validItem,
  itemType: "CONSUMABLE",
  destroyOnUse: true,
  preventBattleUsage: true,
  effects: [effect],
};

describe("Special quest item authoring", () => {
  it("offers the tag and a default editable quest ID", () => {
    expect(tagTypes).toContain("noncombatquest");
    expect(getTagSchema("noncombatquest").parse({})).toMatchObject({
      type: "noncombatquest",
      questId: "",
    });
  });
  it("accepts a noncombat scroll and recognizes it as consumable", () => {
    const result = ItemValidator.safeParse(scroll);
    expect(result.success).toBe(true);
    if (result.success)
      expect(nonCombatConsume(result.data as never, {} as never)).toBe(true);
  });
  it.each([
    { preventBattleUsage: false },
    { destroyOnUse: false },
    { target: "CHARACTER" },
    { method: "AOE" },
    { itemType: "WEAPON" },
  ])("rejects an invalid quest item: %j", (change) => {
    expect(ItemValidator.safeParse({ ...scroll, ...change }).success).toBe(false);
  });
  it("requires a quest ID and only one grant per item", () => {
    expect(
      ItemValidator.safeParse({ ...scroll, effects: [NonCombatQuestTag.parse({})] })
        .success,
    ).toBe(false);
    expect(
      ItemValidator.safeParse({ ...scroll, effects: [effect, effect] }).success,
    ).toBe(false);
    expect(NonCombatQuestTag.safeParse({ questId: "   " }).success).toBe(false);
  });
  it("allows Special authoring with a retry period and zero completion caps", () => {
    const result = QuestValidator.safeParse({
      name: "Special Quest",
      image: "https://example.com/quest.webp",
      description: "A special contract.",
      successDescription: "Contract complete.",
      questRank: "D",
      tierLevel: null,
      questType: "special",
      content: { objectives: [], reward: {} },
      hidden: false,
      consecutiveObjectives: false,
      startsAt: null,
      endsAt: null,
      maxAttempts: 0,
      maxCompletes: 0,
      retryDelay: "daily",
    });
    expect(result.error?.issues).toBeUndefined();
  });
});
