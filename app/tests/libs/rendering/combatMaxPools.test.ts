import { afterEach, describe, expect, it, vi } from "bun:test";
import { getEffectiveMaxPool } from "@/libs/combat/util";
import type {
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import { createCombatMaxPoolCache } from "@/libs/rendering/combatMaxPools";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

let cache = createCombatMaxPoolCache();
afterEach(() => {
  vi.restoreAllMocks();
  cache = createCombatMaxPoolCache();
});
type PoolInfo = {
  users: ReturnedUserState[];
  usersEffects: UserEffect[];
  battle: ReturnedBattle;
  displayed: Map<string, number | undefined>;
};
const sample = (info: PoolInfo) => {
  for (const user of info.users) {
    const values = cache(user, info.battle, info.usersEffects);
    info.displayed.set(`${user.userId}:hp_current`, user.curHealth / values.health);
    info.displayed.set(
      `${user.userId}:sp_current`,
      "curStamina" in user && values.stamina !== undefined
        ? user.curStamina / values.stamina
        : undefined,
    );
    info.displayed.set(
      `${user.userId}:cp_current`,
      "curChakra" in user && values.chakra !== undefined
        ? user.curChakra / values.chakra
        : undefined,
    );
  }
};
const fixture = (count = 1) => {
  const users = Array.from({ length: count }, (_, i) =>
    makeBattleUser(`user-${i}`, {
      longitude: i % 10,
      latitude: Math.floor(i / 10),
      curHealth: 50,
      maxHealth: 100,
      curStamina: 40,
      maxStamina: 80,
      curChakra: 30,
      maxChakra: 60,
    }),
  );
  const battle = makeCompleteBattle({
    usersState: users,
    usersEffects: [],
  }) as unknown as ReturnedBattle;
  const info: PoolInfo = {
    users,
    battle,
    usersEffects: battle.usersEffects,
    displayed: new Map(),
  };
  return {
    info,
    user: users[0]!,
    value: (name = "hp_current") => info.displayed.get(`user-0:${name}`),
  };
};

const poolBonus = (targetId = "user-0") =>
  makeEffect(
    "increasemaxpools",
    {
      power: 20,
      calculation: "percentage",
      poolsAffected: ["Health", "Stamina", "Chakra"],
      rounds: 10,
    },
    { targetId },
  );

describe("combat user pool bars", () => {
  it("does not rescan effects on unchanged frames", () => {
    const { info } = fixture(20);
    let targetReads = 0;
    info.usersEffects = info.users.flatMap((user) =>
      Array.from(
        { length: 10 },
        () =>
          new Proxy(poolBonus(user.userId), {
            get(target, key) {
              if (key === "targetId") targetReads++;
              return Reflect.get(target, key);
            },
          }),
      ),
    );
    sample(info);
    targetReads = 0;
    for (let frame = 0; frame < 60; frame++) sample(info);
    expect(targetReads).toBe(0);
  });

  it("preserves mixed pool modifiers, inactive effects and bloodline sealing", () => {
    const { info, user, value } = fixture();
    info.usersEffects = [
      poolBonus(),
      makeEffect(
        "decreasemaxpools",
        {
          power: 7,
          calculation: "static",
          poolsAffected: ["Health"],
          rounds: 3,
        },
        { targetId: user.userId },
      ),
      { ...poolBonus(), rounds: 0 },
      { ...poolBonus(), targetId: "someone-else" },
      { ...poolBonus(), fromType: "bloodline" },
      makeEffect("seal", { rounds: 3 }, { targetId: user.userId, isNew: false }),
    ];
    sample(info);
    expect(value()).toBeCloseTo(50 / 113);
    expect(value("sp_current")).toBeCloseTo(40 / 96);
    expect(value("cp_current")).toBeCloseTo(30 / 72);
    for (const [name, pool, current] of [
      ["hp_current", "Health", user.curHealth],
      ["sp_current", "Stamina", user.curStamina],
      ["cp_current", "Chakra", user.curChakra],
    ] as const) {
      expect(value(name)).toBeCloseTo(
        current / getEffectiveMaxPool(user, info.usersEffects, pool),
      );
    }
  });

  it("refreshes on replaced effects and snapshots, including same-version previews", () => {
    const { info, value } = fixture();
    sample(info);
    expect(value()).toBe(0.5);
    info.usersEffects = [poolBonus()];
    sample(info);
    expect(value()).toBeCloseTo(50 / 120);
    info.usersEffects[0]!.power = 40;
    info.battle = { ...info.battle };
    sample(info);
    expect(value()).toBeCloseTo(50 / 140);
    info.usersEffects[0]!.rounds = 0;
    info.battle.version++;
    sample(info);
    expect(value()).toBe(0.5);
  });

  it("keeps current values live and refreshes changed base maxima and actors", () => {
    const { info, user, value } = fixture();
    info.usersEffects = [poolBonus()];
    sample(info);
    user.curHealth = 25;
    user.curStamina = 20;
    user.curChakra = 15;
    sample(info);
    expect(value()).toBeCloseTo(25 / 120);
    expect(value("sp_current")).toBeCloseTo(20 / 96);
    expect(value("cp_current")).toBeCloseTo(15 / 72);
    user.maxHealth = 200;
    sample(info);
    expect(value()).toBeCloseTo(25 / 240);
    info.users = [{ ...user, curHealth: 50, maxHealth: 100 }];
    sample(info);
    expect(value()).toBeCloseTo(50 / 120);
  });

  it("refreshes at each timed pool expiry without a battle update", () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { info, value } = fixture();
    info.usersEffects = [
      { ...poolBonus(), timedBuffExpiresAt: 11_000 },
      { ...poolBonus(), timedBuffExpiresAt: 12_000 },
    ];
    sample(info);
    expect(value()).toBeCloseTo(50 / 140);
    now = 11_000;
    sample(info);
    expect(value()).toBeCloseTo(50 / 120);
    now = 12_000;
    sample(info);
    expect(value()).toBe(0.5);
    now = 10_000;
    sample(info);
    expect(value()).toBeCloseTo(50 / 140);
  });

  it("restores a bloodline pool bonus when its seal expires between snapshots", () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { info, user, value } = fixture();
    info.usersEffects = [
      { ...poolBonus(), fromType: "bloodline" },
      makeEffect(
        "seal",
        { rounds: 3 },
        {
          targetId: user.userId,
          isNew: false,
          timedBuffExpiresAt: 11_000,
        },
      ),
      makeEffect("seal", { rounds: 3 }, { targetId: user.userId, isNew: true }),
      makeEffect("seal", { rounds: 3 }, { targetId: "someone-else", isNew: false }),
    ];
    sample(info);
    expect(value()).toBe(0.5);
    now = 11_000;
    sample(info);
    expect(value()).toBeCloseTo(50 / 120);
    expect(value("sp_current")).toBeCloseTo(40 / 96);
    expect(value("cp_current")).toBeCloseTo(30 / 72);
  });

  it("keeps masked opponents' private pool bars absent", () => {
    const { info, value } = fixture();
    const user = { ...info.users[0]! };
    for (const key of ["curStamina", "maxStamina", "curChakra", "maxChakra"]) {
      Reflect.deleteProperty(user, key);
    }
    info.users = [user];
    sample(info);
    expect(value()).toBe(0.5);
    expect(value("sp_current")).toBeUndefined();
    expect(value("cp_current")).toBeUndefined();
  });

  it("clears maxima when renderer caches reset", () => {
    const { info, value } = fixture();
    info.usersEffects = [poolBonus()];
    sample(info);
    expect(value()).toBeCloseTo(50 / 120);
    info.usersEffects[0]!.power = 40;
    cache = createCombatMaxPoolCache();
    sample(info);
    expect(value()).toBeCloseTo(50 / 140);
  });
});
