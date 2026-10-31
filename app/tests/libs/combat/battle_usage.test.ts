import { describe, expect, it } from "bun:test";
import {
  type BattleType,
  BattleTypes,
  type BattleUsageType,
  QuestBattleTypes,
} from "@/drizzle/constants";
import { availableUserActions } from "@/libs/combat/actions";
import { fitsBattleUsage } from "@/libs/combat/participants";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeBattleWithWeapon,
  makeInjectBattle,
  makeTag,
} from "./helpers/battleScenario";

const USAGES = ["PVE", "PVP", "BOTH"] as const satisfies readonly BattleUsageType[];

const battleWithUsageContent = (battleType: BattleType) => {
  const jutsus = USAGES.map((usage) => ({
    ...SAGE_MODE_ACTIVATION_JUTSU,
    id: `jutsu-${usage}`,
    name: `Jutsu ${usage}`,
    battleUsageType: usage,
    effects: [makeTag("heal")],
  }));
  const weapon = makeBattleWithWeapon().extraState.items!["weapon-1"]!;
  const items = USAGES.map((usage) => ({
    ...weapon,
    id: `pill-${usage}`,
    name: `Pill ${usage}`,
    itemType: "CONSUMABLE" as const,
    battleUsageType: usage,
    effects: [makeTag("heal")],
  }));
  const user = makeBattleUser("caster", {
    jutsus: jutsus.map((jutsu) => ({
      id: jutsu.id,
      jutsuId: jutsu.id,
      equipped: true,
      level: 1,
      experience: 0,
      lastUsedRound: -10,
      originalCooldown: 0,
      origin: "user" as const,
    })),
    items: items.map((item, index) =>
      makeBattleUserItem({
        id: `user-${item.id}`,
        itemId: item.id,
        equipped: `ITEM_${index + 1}` as "ITEM_1",
        quantity: 1,
        lastUsedRound: -10,
      }),
    ),
  });
  return makeInjectBattle(
    user,
    {
      jutsus: Object.fromEntries(jutsus.map((jutsu) => [jutsu.id, jutsu])),
      items: Object.fromEntries(items.map((item) => [item.id, item])),
    },
    { round: 2, battleType },
  );
};

const usableUsages = (battleType: BattleType, type: "jutsu" | "item") =>
  availableUserActions(battleWithUsageContent(battleType), "caster", false, true)
    .filter((action) => action.type === type)
    .map((action) => action.name.split(" ")[1])
    .sort();

describe("battle usage restrictions", () => {
  it.each(["ARENA", "TRAINING"] as const)(
    "%s battles allow PvE-only, PvP-only and shared jutsu and items",
    (battleType) => {
      expect(usableUsages(battleType, "jutsu")).toEqual(["BOTH", "PVE", "PVP"]);
      expect(usableUsages(battleType, "item")).toEqual(["BOTH", "PVE", "PVP"]);
    },
  );

  it.each(QuestBattleTypes)("%s battles exclude PvP-only content", (battleType) => {
    expect(usableUsages(battleType, "jutsu")).toEqual(["BOTH", "PVE"]);
    expect(usableUsages(battleType, "item")).toEqual(["BOTH", "PVE"]);
  });

  it.each(["COMBAT", "SPARRING", "RANKED_PVP", "VILLAGE_PROTECTOR"] as const)(
    "%s battles exclude PvE-only content",
    (battleType) => {
      expect(usableUsages(battleType, "jutsu")).toEqual(["BOTH", "PVP"]);
      expect(usableUsages(battleType, "item")).toEqual(["BOTH", "PVP"]);
    },
  );

  it("allows shared content in every battle type", () => {
    for (const battleType of BattleTypes) {
      expect(fitsBattleUsage(battleType, "BOTH")).toBe(true);
    }
  });
});
