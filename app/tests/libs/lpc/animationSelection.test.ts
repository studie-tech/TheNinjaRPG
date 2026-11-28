import { expect, it } from "bun:test";
import { spriteActionAnimation } from "@/libs/lpc/actions";

it("selects attack families from combat semantics and the captured equipment appearance", () => {
  const action = { id: "weapon", type: "item", effects: [] };
  expect(spriteActionAnimation({ ...action, data: { weaponType: "BOW" } })).toBe(
    "shoot",
  );
  expect(
    spriteActionAnimation(
      { ...action, data: { weaponType: "BOW", lpcProfile: "bow" } },
      "crossbow",
    ),
  ).toBe("crossbow");
  expect(spriteActionAnimation({ ...action, data: { weaponType: "SHURIKEN" } })).toBe(
    "throw",
  );
  expect(
    spriteActionAnimation({ ...action, data: { weaponType: "NONE" } }, "boomerang"),
  ).toBe("throw");
  expect(
    spriteActionAnimation({ ...action, data: { weaponType: "FIST_WEAPON" } }),
  ).toBe("punch");
  expect(spriteActionAnimation({ ...action, id: "basicAttack" })).toBe("punch");
  expect(
    spriteActionAnimation({ ...action, data: { statClassification: "Taijutsu" } }),
  ).toBe("punch");
  expect(spriteActionAnimation({ ...action, data: { weaponType: "SWORD" } })).toBe(
    "slash",
  );
  expect(spriteActionAnimation({ ...action, data: { weaponType: "POLEARM" } })).toBe(
    "thrust",
  );
  expect(spriteActionAnimation({ ...action, id: "defensiveStance" })).toBe("block");
  expect(spriteActionAnimation({ ...action, id: "wait" })).toBe("idle");
  expect(
    spriteActionAnimation({
      ...action,
      type: "jutsu",
      data: { statClassification: "Ninjutsu" },
    }),
  ).toBe("spellcast");
});
