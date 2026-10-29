import { expect, it } from "bun:test";
import { performBattleAction, userItemToAction } from "@/libs/combat/actions";
import { getBattleGrid } from "@/libs/combat/util";
import { resolveSpriteAppearance, withSpriteEquipment } from "@/libs/lpc/appearance";
import { makeBattleUser, makeBattleUserItem, makeBattleWithWeapon, makeCompleteBattle } from "../combat/helpers/battleScenario";

it("removes broken gear from the captured appearance and emits a unique attack cue in memory", () => {
  const owned = makeBattleUserItem({ durability: 3 });
  const base = resolveSpriteAppearance({ attributes: ["Long Hair"] });
  const equipment = { [owned.id]: { slot: "HAND_1", profile: "katana", color: "red" } };
  const user = makeBattleUser("sprite-wearer", {
    longitude: 3, latitude: 3, items: [owned],
    spriteBaseAppearance: base, spriteEquipment: equipment,
    spriteAppearance: withSpriteEquipment(base, Object.values(equipment)),
    spriteAction: { id: "previous", animation: "slash", longitude: 4, latitude: 3 },
  });
  const enemy = makeBattleUser("sprite-opponent", { longitude: 4, latitude: 3 });
  const weaponState = makeBattleWithWeapon({ item: { weaponType: "SWORD", slot: "HAND" } }).extraState;
  const battle = makeCompleteBattle({
    createdAt: new Date(0), width: 12, height: 10, round: 5,
    activeUserId: user.userId, usersState: [user, enemy],
    extraState: { items: weaponState.items, jutsus: {}, bloodlines: {}, villages: {}, wars: {}, clans: {} },
  });
  const action = userItemToAction(owned, user, battle);
  const { newBattle } = performBattleAction({ battle, action, grid: getBattleGrid(1, battle), contextUserId: user.userId, actorId: user.userId, longitude: 4, latitude: 3 });
  const wearer = newBattle.usersState.find((entry) => entry.userId === user.userId)!;
  expect(wearer.items[0]?.equipped).toBe("NONE");
  expect(wearer.spriteAppearance).toEqual(base);
  expect(wearer.spriteAction).toMatchObject({ animation: "slash", longitude: 4, latitude: 3 });
  expect(wearer.spriteAction?.id).not.toBe("previous");
});
