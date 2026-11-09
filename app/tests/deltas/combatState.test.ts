import { describe, expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import superjson from "superjson";
import {
  buildCombatStateUpdate,
  captureCombatStateUpdate,
  getCombatEventUpdate,
  getCombatStateUpdate,
} from "@/deltas/combat";
import { maskBattle } from "@/libs/combat/masking";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../setup/combat";

const fixture = () =>
  makeCompleteBattle({
    id: "battle",
    version: 1,
    usersState: [
      makeBattleUser("actor", { strength: 1234567 }),
      makeBattleUser("viewer", { intelligence: 7654321 }),
    ],
  });

describe("public combat state updates", () => {
  it("reconstructs canonical viewer state while withholding changed private actor fields", () => {
    const battle = fixture();
    const original = structuredClone(battle);
    const baseline = captureCombatStateUpdate(battle);
    battle.version++;
    battle.usersState[0]!.longitude++;
    battle.usersState[0]!.strength++;
    const update = buildCombatStateUpdate(baseline, battle)!;
    expect(update.userIds).toEqual(["viewer"]);
    expect(JSON.stringify(update)).not.toContain("123456");
    expect(JSON.stringify(update)).not.toContain("7654321");
    const current = { battle: maskBattle(original, "viewer"), result: null };
    expect(
      getCombatEventUpdate(
        current,
        superjson.deserialize(superjson.serialize(update)),
        "viewer",
      ),
    ).toEqual({ battle: maskBattle(battle, "viewer"), result: null });
    expect(current.battle).toEqual(maskBattle(original, "viewer"));
    expect(
      getCombatEventUpdate(
        { battle: maskBattle(original, "actor"), result: null },
        update,
        "actor",
      ),
    ).toBeUndefined();
  });

  it("preserves viewer-only effect metadata across public changes and removes departed effects", () => {
    const battle = fixture();
    battle.usersEffects = [
      makeEffect(
        "damage",
        {},
        {
          id: "owned",
          creatorId: "viewer",
          targetId: "actor",
          highestGenerals: ["strength"],
          rounds: 3,
        },
      ),
      makeEffect(
        "damage",
        {},
        { id: "expired", creatorId: "actor", targetId: "viewer" },
      ),
    ];
    const original = structuredClone(battle);
    const baseline = captureCombatStateUpdate(battle);
    battle.version++;
    battle.usersEffects = [{ ...battle.usersEffects[0]!, rounds: 2 }];
    const update = buildCombatStateUpdate(baseline, battle)!;
    expect(update.userIds).toContain("viewer");
    expect(JSON.stringify(update)).not.toContain("highestGenerals");
    expect(
      getCombatEventUpdate(
        { battle: maskBattle(original, "viewer"), result: null },
        update,
        "viewer",
      )?.battle,
    ).toEqual(maskBattle(battle, "viewer"));
  });

  it.each(["private", "catalog", "hidden-template", "dead", "fled", "settled"])(
    "withholds unsupported %s transitions from the affected viewer",
    (transition) => {
      const battle = fixture();
      const baseline = captureCombatStateUpdate(battle);
      battle.version++;
      const viewer = battle.usersState[1]!;
      if (transition === "private")
        viewer.items = [{ id: "private-item", durability: 2 } as never];
      if (transition === "catalog") {
        battle.extraState.revealedActions = { jutsuIds: ["new-jutsu"], itemIds: [] };
        battle.extraState.jutsus = {
          "new-jutsu": { id: "new-jutsu", effects: [] } as never,
        };
      }
      if (transition === "hidden-template")
        battle.usersState.push(
          makeBattleUser("template", {
            isAi: true,
            isSummon: true,
            isSummonTemplate: true,
            controllerId: "hidden-controller",
          }),
        );
      if (transition === "dead") viewer.curHealth = 0;
      if (transition === "fled") viewer.fledBattle = true;
      if (transition === "settled") viewer.leftBattle = true;
      const update = buildCombatStateUpdate(baseline, battle);
      if (transition === "hidden-template") {
        expect(JSON.stringify(update ?? {})).not.toContain("hidden-controller");
      } else expect(update?.userIds ?? []).not.toContain("viewer");
    },
  );

  it("requires the exact baseline and participant identity while retaining newer and held results", () => {
    const battle = fixture();
    const original = structuredClone(battle);
    const baseline = captureCombatStateUpdate(battle);
    battle.version += 3;
    battle.round++;
    const update = buildCombatStateUpdate(baseline, battle)!;
    const current = { battle: maskBattle(original, "viewer"), result: null };
    expect(getCombatEventUpdate(current, update, "viewer")?.battle?.version).toBe(
      battle.version,
    );
    expect(
      getCombatEventUpdate(
        current,
        { ...update, previousVersion: original.version + 1 },
        "viewer",
      ),
    ).toBeUndefined();
    expect(getCombatEventUpdate(current, update, "spectator")).toBeUndefined();
    expect(
      getCombatEventUpdate(
        current,
        { ...update, fields: { ...update.fields, id: "other" } },
        "viewer",
      ),
    ).toBeUndefined();
    const newer = {
      battle: { ...current.battle, version: battle.version + 1 },
      result: null,
    };
    expect(getCombatEventUpdate(newer, update, "viewer")).toBe(newer);
    const held = { ...current, result: { outcome: "Won" } as never };
    expect(getCombatEventUpdate(held, update, "viewer")).toBe(held);
  });

  it("does not capture solo fights or publish unchanged versions", () => {
    expect(
      captureCombatStateUpdate(
        makeCompleteBattle({ usersState: [makeBattleUser("solo")] }),
      ),
    ).toBeUndefined();
    const battle = fixture();
    expect(
      buildCombatStateUpdate(captureCombatStateUpdate(battle), battle),
    ).toBeUndefined();
  });
});

const state = (version: number, result = false) =>
  ({
    battle: { id: "shared", version },
    result: result ? { outcome: "Won" } : null,
  }) as RouterOutputs["combat"]["getBattle"];

it("accepts a complete snapshot before an initial read or after a missing-row response", () => {
  const confirmed = state(3, true);
  expect(
    getCombatStateUpdate({ battle: null, result: null }, confirmed, "shared"),
  ).toEqual(confirmed);
});

it("preserves a terminal result when a late action or peer snapshot arrives", () => {
  const confirmed = state(3, true);
  expect(getCombatStateUpdate(confirmed, state(4), "shared")).toBe(confirmed);
});

it("rejects mismatched battles and preserves newer versions", () => {
  const confirmed = state(3);
  expect(getCombatStateUpdate(confirmed, state(2), "shared")).toBe(confirmed);
  expect(getCombatStateUpdate(confirmed, state(4), "other")).toBeUndefined();
  expect(
    getCombatStateUpdate(
      { ...confirmed, battle: { ...confirmed.battle!, id: "other" } },
      state(4),
      "shared",
    ),
  ).toBeUndefined();
});
