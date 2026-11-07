import { describe, expect, it } from "bun:test";
import { insertQuestForCreate } from "@/queries/quests";

describe("insertQuestForCreate", () => {
  it("stores an empty reward with every default the editor expects", () => {
    let values: { content: { reward: unknown } } | undefined;
    const client = {
      insert: () => ({
        values: (row: typeof values) => {
          values = row;
        },
      }),
    };
    insertQuestForCreate(client as never, "new");
    expect(values?.content.reward).toEqual({
      reward_medical_experience: 0,
      reward_hunting_experience: 0,
      reward_crafting_experience: 0,
      reward_gathering_experience: 0,
      reward_sage_mastery_experience: 0,
      reward_seichi_silver: 0,
      reward_money: 0,
      reward_clanpoints: 0,
      reward_anbupoints: 0,
      reward_exp: 0,
      reward_tokens: 0,
      reward_prestige: 0,
      reward_reputation: 0,
      reward_skillpoints: 0,
      reward_jutsus: [],
      reward_bloodlines: [],
      reward_sage_modes: [],
      reward_badges: [],
      reward_titles: [],
      reward_items: [],
      reward_rank: "NONE",
      reward_village_membership: "NONE",
      reward_hunter_items: false,
      reward_gathering_items: false,
      reward_hunter_items_ids: [],
      reward_gathering_items_ids: [],
      reward_war_damage: 0,
      reward_war_healing: 0,
    });
  });
});
