import { describe, expect, it } from "bun:test";
import { getTagSchema, ItemValidator } from "@/validators/combat";
import { validItemInput } from "../setup/items";

const tag = (type: Parameters<typeof getTagSchema>[0]) =>
  getTagSchema(type).parse({ type });

const consumable = {
  itemType: "CONSUMABLE",
  target: "SELF",
  method: "SINGLE",
  destroyOnUse: true,
  preventBattleUsage: true,
};

const rule = (input: object) => {
  const result = ItemValidator.safeParse(validItemInput(input));
  return result.error?.issues.map((issue) => issue.message) ?? [];
};

/** Shared item shape that fails each of the three consume-on-self conditions. */
const misconfigured = {
  ...consumable,
  itemType: "WEAPON",
  target: "CHARACTER",
  method: "ALL",
};

describe("self-consumable item rules", () => {
  it.each([
    ["noncombatconsumereward", "Non-combat consume reward"],
    ["rollbloodline", "Items with bloodline/sage roll"],
    ["removebloodline", "Items with bloodline/sage roll"],
    ["rollsagemode", "Items with bloodline/sage roll"],
    ["unlockitemvariant", "Items with unlockitemvariant"],
  ] as const)("%s needs a consumable self-targeted single use", (type, label) => {
    expect(rule({ ...consumable, effects: [tag(type)] })).toEqual([]);
    expect(rule({ ...misconfigured, effects: [tag(type)] })).toEqual(
      expect.arrayContaining([
        `${label} must be consumable.`,
        `${label} must target self`,
        `${label} must have single method`,
      ]),
    );
  });

  it("reports each broken condition on its own, in order", () => {
    const effects = [
      tag("noncombatconsumereward"),
      tag("rollbloodline"),
      tag("unlockitemvariant"),
    ];
    const messages = rule({ ...consumable, target: "CHARACTER", effects });
    expect(messages.filter((message) => message.includes("must target self"))).toEqual([
      "Non-combat consume reward must target self",
      "Items with bloodline/sage roll must target self",
      "Items with unlockitemvariant must target self",
    ]);
    expect(messages.some((message) => message.endsWith("must be consumable."))).toBe(
      false,
    );
    expect(
      messages.some((message) => message.endsWith("must have single method")),
    ).toBe(false);
  });

  it("keeps the extra unlockitemvariant requirements", () => {
    const effects = [tag("unlockitemvariant")];
    expect(rule({ ...consumable, destroyOnUse: false, effects })).toContain(
      "Items with unlockitemvariant must be destroyed on use",
    );
    expect(rule({ ...consumable, preventBattleUsage: false, effects })).toContain(
      "Items with unlockitemvariant must have preventBattleUsage enabled",
    );
  });
});
