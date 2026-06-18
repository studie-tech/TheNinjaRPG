import { emptyPreBattleGearModifiers, computeDamagePacket } from "@/libs/combat/process";
import { clear, cleanse } from "@/libs/combat/tags";
import type {
  BattleUserState,
  PreBattleGearModifiers,
  UserEffect,
} from "@/libs/combat/types";
import {
  ClearTag,
  CleanseTag,
  DamageTag,
  DecreaseDamageTakenTag,
  IncreaseDamageTakenTag,
  type ZodAllTags,
} from "@/validators/combat";

type RuntimeEffectFields = Pick<
  UserEffect,
  | "id"
  | "creatorId"
  | "targetId"
  | "level"
  | "isNew"
  | "castThisRound"
  | "createdRound"
  | "longitude"
  | "latitude"
  | "barrierAbsorb"
  | "actionId"
> & {
  fromType?: UserEffect["fromType"];
};

const toUserEffect = (tag: ZodAllTags, runtime: RuntimeEffectFields): UserEffect => ({
  ...tag,
  ...runtime,
});

export const makeBattleUser = (
  id: string,
  overrides: Partial<BattleUserState> = {},
): BattleUserState =>
  ({
    userId: id,
    username: id,
    gender: "Male",
    villageId: "village-1",
    direction: id === "attacker" ? "left" : "right",
    level: 100,
    experience: 0,
    longitude: id === "attacker" ? 0 : 1,
    latitude: 0,
    curHealth: 5000,
    maxHealth: 5000,
    curChakra: 5000,
    maxChakra: 5000,
    curStamina: 5000,
    maxStamina: 5000,
    actionPoints: 100,
    ninjutsuOffence: 450000,
    ninjutsuDefence: 450000,
    genjutsuOffence: 450000,
    genjutsuDefence: 450000,
    taijutsuOffence: 450000,
    taijutsuDefence: 450000,
    bukijutsuOffence: 450000,
    bukijutsuDefence: 450000,
    strength: 100000,
    intelligence: 100000,
    willpower: 100000,
    speed: 100000,
    highestOffence: "ninjutsuOffence",
    highestDefence: "ninjutsuDefence",
    highestGenerals: ["strength", "intelligence"],
    fledBattle: false,
    leftBattle: false,
    usedActions: [],
    items: [],
    jutsus: [],
    basicActions: [],
    usedGenerals: { strength: 0, intelligence: 0, willpower: 0, speed: 0 },
    usedStats: {
      ninjutsuOffence: 0,
      genjutsuOffence: 0,
      taijutsuOffence: 0,
      bukijutsuOffence: 0,
      ninjutsuDefence: 0,
      genjutsuDefence: 0,
      taijutsuDefence: 0,
      bukijutsuDefence: 0,
    },
    ...overrides,
  }) as unknown as BattleUserState;

export const makeDamageEffect = (
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  toUserEffect(
    DamageTag.parse({
      power: 40,
      calculation: "formula",
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      elements: [],
    }),
    {
      id: "damage-1",
      creatorId: "attacker",
      targetId: "defender",
      level: 1,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      longitude: 0,
      latitude: 0,
      barrierAbsorb: 0,
      actionId: "damage-action",
      ...overrides,
    },
  );

export const makeDamageTakenEffect = (params: {
  id: string;
  targetId: string;
  type: "decreasedamagetaken" | "increasedamagetaken";
  fromType?: UserEffect["fromType"];
  rounds?: number;
  power?: number;
}): UserEffect => {
  const tagInput = {
    power: params.power ?? 10,
    rounds: params.rounds ?? 10,
    calculation: "percentage" as const,
    statTypes: ["Ninjutsu"] as const,
    generalTypes: [],
  };
  const tag =
    params.type === "decreasedamagetaken"
      ? DecreaseDamageTakenTag.parse(tagInput)
      : IncreaseDamageTakenTag.parse(tagInput);

  return toUserEffect(tag, {
    id: params.id,
    creatorId: params.targetId,
    targetId: params.targetId,
    level: 0,
    isNew: false,
    castThisRound: false,
    createdRound: 0,
    longitude: 0,
    latitude: 0,
    barrierAbsorb: 0,
    actionId: params.id,
    fromType: params.fromType,
  });
};

export const gearMods = (
  overrides: Partial<PreBattleGearModifiers> = {},
): PreBattleGearModifiers => ({
  ...emptyPreBattleGearModifiers(),
  ...overrides,
});

export class BattleScenario {
  users = new Map<string, BattleUserState>();
  effects: UserEffect[] = [];
  preBattleGearModifiers: Record<string, PreBattleGearModifiers> = {};
  round = 1;

  constructor() {
    this.addUser("attacker");
    this.addUser("defender");
  }

  addUser(id: string, overrides: Partial<BattleUserState> = {}) {
    this.users.set(id, makeBattleUser(id, overrides));
    this.preBattleGearModifiers[id] ??= gearMods();
    return this;
  }

  addEffect(effect: UserEffect) {
    this.effects.push(effect);
    return this;
  }

  setGearModifiers(userId: string, modifiers: Partial<PreBattleGearModifiers>) {
    this.preBattleGearModifiers[userId] = gearMods(modifiers);
    return this;
  }

  clearPositive(targetId: string) {
    const target = this.getUser(targetId);
    const effect = toUserEffect(ClearTag.parse({ power: 100 }), {
      id: `clear-${targetId}`,
      creatorId: "attacker",
      targetId,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: this.round,
      longitude: target.longitude,
      latitude: target.latitude,
      barrierAbsorb: 0,
      actionId: "clear",
      fromType: "basic",
    });
    return clear(effect, this.effects, target);
  }

  cleanseNegative(targetId: string) {
    const target = this.getUser(targetId);
    const effect = toUserEffect(CleanseTag.parse({ power: 100 }), {
      id: `cleanse-${targetId}`,
      creatorId: "attacker",
      targetId,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: this.round,
      longitude: target.longitude,
      latitude: target.latitude,
      barrierAbsorb: 0,
      actionId: "cleanse",
      fromType: "basic",
    });
    return cleanse(effect, this.effects, target);
  }

  computeDamage(rawDamage = 1000, damageEffect = makeDamageEffect()) {
    return computeDamagePacket({
      rawDamage,
      damageEffect,
      usersEffects: this.effects,
      attackerId: damageEffect.creatorId,
      defenderId: damageEffect.targetId,
      preBattleGearModifiers: this.preBattleGearModifiers,
      battleRound: this.round,
    }).damage;
  }

  getEffect(id: string) {
    const effect = this.effects.find((e) => e.id === id);
    if (!effect) throw new Error(`Effect not found: ${id}`);
    return effect;
  }

  private getUser(id: string) {
    const user = this.users.get(id);
    if (!user) throw new Error(`User not found: ${id}`);
    return user;
  }
}

export const battleScenario = () => new BattleScenario();
