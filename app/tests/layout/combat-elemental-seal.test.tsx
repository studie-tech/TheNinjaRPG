import { afterEach, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { CombatElementalSealNotice } from "@/layout/CombatElementalSealNotice";
import { availableUserActions } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { makeBattleUser, makeEffect, makeInjectBattle, makeTag } from "../setup/combat";

afterEach(() => cleanup());

const fixture = () => {
  const jutsus = ["Storm Fist", "Thunderbolt Fury", "Burning Coil"].map((name) => ({
    ...SAGE_MODE_ACTIVATION_JUTSU,
    id: name,
    name,
    jutsuType: "NORMAL" as const,
    battleUsageType: "PVE" as const,
    actionCostPerc: 60,
    elementClassification: (name === "Burning Coil" ? "Fire" : "Lightning") as
      | "Fire"
      | "Lightning",
    effects: [makeTag("damage")],
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
  });
  return makeInjectBattle(
    user,
    { jutsus: Object.fromEntries(jutsus.map((jutsu) => [jutsu.id, jutsu])) },
    { battleType: "QUEST", round: 2 },
  );
};

it("explains a PvE loadout disappearing under a seal and restores it when the seal ends", () => {
  const battle = fixture();
  const names = ["Storm Fist", "Thunderbolt Fury", "Burning Coil"];
  const jutsuNames = () =>
    availableUserActions(battle, "caster")
      .filter((action) => action.type === "jutsu")
      .map((action) => action.name);
  const notice = () => <CombatElementalSealNotice battle={battle} userId="caster" />;
  const view = render(notice());
  const status = view.getByRole("status");
  expect(jutsuNames()).toEqual(names);
  expect(status.textContent).toBe("");
  expect(status.getAttribute("aria-atomic")).toBe("true");

  const seal = makeEffect(
    "elementalseal",
    { rounds: 2 },
    {
      targetId: "caster",
      castThisRound: false,
    },
  );
  battle.usersEffects = [seal];
  view.rerender(notice());
  expect(jutsuNames()).toEqual([]);
  expect(view.getByRole("status")).toBe(status);
  expect(view.getByRole("status").textContent).toContain("until the seal ends");
  expect(battle.usersState[0]!.jutsus.map((entry) => entry.jutsuId)).toEqual(names);

  seal.rounds = 0;
  battle.round += 2;
  view.rerender(notice());
  expect(jutsuNames()).toEqual(names);
  expect(view.getByRole("status")).toBe(status);
  expect(status.textContent).toBe("");
});

it("follows the controlled actor and waits until a newly cast seal takes effect", () => {
  const battle = fixture();
  const seal = makeEffect(
    "elementalseal",
    { rounds: 2 },
    {
      targetId: "summon",
      castThisRound: true,
    },
  );
  battle.usersEffects = [seal];
  const view = render(<CombatElementalSealNotice battle={battle} userId="summon" />);
  expect(view.getByRole("status").textContent).toBe("");
  seal.castThisRound = false;
  view.rerender(<CombatElementalSealNotice battle={battle} userId="summon" />);
  expect(view.getByRole("status").textContent).toContain("Elemental Seal is active.");
  view.rerender(<CombatElementalSealNotice battle={battle} userId="caster" />);
  expect(view.getByRole("status").textContent).toBe("");
});
