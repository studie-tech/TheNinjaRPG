import { expect, it } from "bun:test";
import { resolveSpriteEquipment, type SpriteUser } from "@/libs/lpc/appearance";

it("overrides each occupied slot while preserving real instance IDs and item data", () => {
  const items: SpriteUser["items"] = [
    {
      id: "real-one",
      equipped: "HAND_1",
      quantity: 1,
      item: { id: "sword", slot: "HAND", lpcProfile: "sword" },
    },
    {
      id: "real-two",
      equipped: "HAND_2",
      quantity: 1,
      item: { id: "sword", slot: "HAND", lpcProfile: "sword" },
    },
  ];
  const before = structuredClone(items);
  const cosmeticSlots: SpriteUser["cosmeticSlots"] = [
    {
      slot: "HAND_1",
      item: { slot: "HAND", lpcProfile: "axe" },
      variant: { lpcProfile: "gold-axe", lpcColor: "gold" },
    },
    { slot: "HEAD", item: { slot: "HEAD", lpcProfile: "mask" } },
  ];
  expect(resolveSpriteEquipment(items, cosmeticSlots)).toEqual({
    "real-one": { slot: "HAND_1", profile: "gold-axe", color: "gold" },
    "real-two": { slot: "HAND_2", profile: "sword", color: "gray", mirror: true },
  });
  expect(items).toEqual(before);
  expect(resolveSpriteEquipment(items, [])["real-one"]?.profile).toBe("sword");
});

it("ignores cosmetics on incompatible, absent or consumed equipment slots", () => {
  const slots: SpriteUser["cosmeticSlots"] = [
    { slot: "HEAD", item: { slot: "FEET", lpcProfile: "boots" } },
  ];
  const helmet = {
    id: "helmet",
    equipped: "HEAD",
    quantity: 1,
    item: { slot: "HEAD", lpcProfile: "helmet" },
  };
  expect(resolveSpriteEquipment([helmet], slots).helmet?.profile).toBe("helmet");
  expect(resolveSpriteEquipment([{ ...helmet, quantity: 0 }], slots)).toEqual({});
  expect(resolveSpriteEquipment([], slots)).toEqual({});
});
