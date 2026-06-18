import { z } from "zod";
import { GenNames, StatNames } from "@/libs/combat/constants";
import { emptyPreBattleGearModifiers, computeDamagePacket } from "@/libs/combat/process";
import { clear, cleanse } from "@/libs/combat/tags";
import type {
  BattleBasicAction,
  BattleUserItem,
  BattleUserJutsu,
  BattleUserState,
  PreBattleGearModifiers,
  UserEffect,
} from "@/libs/combat/types";
import { getTagSchema, type ZodAllTags } from "@/validators/combat";

type TagType = ZodAllTags["type"];
type TagFor<T extends TagType> = Extract<ZodAllTags, { type: T }>;
type TagFields<T extends TagType> = Partial<Omit<TagFor<T>, "type">>;
type DamageModifierType = Extract<
  TagType,
  | "increasedamagegiven"
  | "decreasedamagegiven"
  | "increasedamagetaken"
  | "decreasedamagetaken"
>;
type BattleUserOverrides = Partial<BattleUserState> & Record<string, unknown>;
type EffectRuntimeOverrides = Partial<UserEffect> & Record<string, unknown>;

const effectSourceTypes = [
  "jutsu",
  "armor",
  "accessory",
  "keystone",
  "item",
  "basic",
  "bloodline",
  "village",
  "skill",
  "ranked",
] as const satisfies readonly NonNullable<UserEffect["fromType"]>[];

const statNameSchema = z.enum(StatNames);
const genNameSchema = z.enum(GenNames);

const recordWith = <Key extends string, Value>(
  keys: readonly Key[],
  value: Value,
): Record<Key, Value> =>
  Object.fromEntries(keys.map((key) => [key, value])) as Record<Key, Value>;

const numberFields = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, z.coerce.number()])) as z.ZodRawShape;

const statDefaults = recordWith(StatNames, 450_000);
const generalDefaults = recordWith(GenNames, 100_000);
const usedStatDefaults = recordWith(StatNames, 0);
const usedGeneralDefaults = recordWith(GenNames, 0);

export const battleUserSchema = z
  .object({
    ...numberFields(StatNames),
    ...numberFields(GenNames),
    userId: z.string(),
    controllerId: z.string(),
    username: z.string(),
    gender: z.string(),
    villageId: z.string(),
    direction: z.enum(["left", "right"]),
    isAggressor: z.boolean(),
    level: z.coerce.number(),
    experience: z.coerce.number(),
    longitude: z.coerce.number(),
    latitude: z.coerce.number(),
    curHealth: z.coerce.number(),
    maxHealth: z.coerce.number(),
    curChakra: z.coerce.number(),
    maxChakra: z.coerce.number(),
    curStamina: z.coerce.number(),
    maxStamina: z.coerce.number(),
    actionPoints: z.coerce.number(),
    highestOffence: statNameSchema,
    highestDefence: statNameSchema,
    highestGenerals: z.array(genNameSchema),
    round: z.coerce.number(),
    iAmHere: z.boolean(),
    originalLevel: z.coerce.number(),
    originalMoney: z.coerce.number(),
    originalLongitude: z.coerce.number(),
    originalLatitude: z.coerce.number(),
    isOriginal: z.boolean(),
    usedGenerals: z.record(genNameSchema, z.coerce.number()),
    usedStats: z.record(statNameSchema, z.coerce.number()),
    leftBattle: z.boolean(),
    fledBattle: z.boolean(),
    moneyStolen: z.coerce.number(),
    allyVillage: z.boolean(),
    usedActions: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(["jutsu", "item", "basic", "bloodline"]),
        })
        .passthrough(),
    ),
    initiative: z.coerce.number(),
    basicActions: z.array(z.custom<BattleBasicAction>()),
    relationIds: z.array(z.string()),
    warIds: z.array(z.string()),
    items: z.array(z.custom<BattleUserItem>()),
    jutsus: z.array(z.custom<BattleUserJutsu>()),
  })
  .passthrough();

const effectRuntimeSchema = z
  .object({
    id: z.string(),
    creatorId: z.string(),
    targetId: z.string(),
    level: z.coerce.number(),
    isNew: z.boolean(),
    castThisRound: z.boolean(),
    createdRound: z.coerce.number(),
    longitude: z.coerce.number(),
    latitude: z.coerce.number(),
    barrierAbsorb: z.coerce.number(),
    actionId: z.string(),
    fromType: z.enum(effectSourceTypes).optional(),
  })
  .passthrough();

const defaultBattleUser = (id: string): BattleUserOverrides => {
  const longitude = id === "attacker" ? 0 : 1;

  return {
    userId: id,
    controllerId: id,
    username: id,
    gender: "Male",
    villageId: "village-1",
    direction: id === "attacker" ? "left" : "right",
    isAggressor: id === "attacker",
    level: 100,
    experience: 0,
    longitude,
    latitude: 0,
    curHealth: 5000,
    maxHealth: 5000,
    curChakra: 5000,
    maxChakra: 5000,
    curStamina: 5000,
    maxStamina: 5000,
    actionPoints: 100,
    ...statDefaults,
    ...generalDefaults,
    highestOffence: "ninjutsuOffence",
    highestDefence: "ninjutsuDefence",
    highestGenerals: ["strength", "intelligence"],
    round: 1,
    iAmHere: true,
    originalLevel: 100,
    originalMoney: 0,
    originalLongitude: longitude,
    originalLatitude: 0,
    isOriginal: true,
    usedGenerals: usedGeneralDefaults,
    usedStats: usedStatDefaults,
    fledBattle: false,
    leftBattle: false,
    moneyStolen: 0,
    allyVillage: false,
    usedActions: [],
    items: [],
    jutsus: [],
    basicActions: [],
    initiative: 0,
    relationIds: [],
    warIds: [],
  };
};

export const makeBattleUser = (
  id: string,
  overrides: BattleUserOverrides = {},
): BattleUserState =>
  battleUserSchema.parse({
    ...defaultBattleUser(id),
    ...overrides,
    usedGenerals: { ...usedGeneralDefaults, ...overrides.usedGenerals },
    usedStats: { ...usedStatDefaults, ...overrides.usedStats },
  }) as BattleUserState;

export const makeTag = <T extends TagType>(
  type: T,
  fields: TagFields<T> = {},
): TagFor<T> => getTagSchema(type).parse({ type, ...fields }) as TagFor<T>;

export const makeEffect = <T extends TagType>(
  type: T,
  tagFields: TagFields<T> = {},
  runtimeFields: EffectRuntimeOverrides = {},
): UserEffect => {
  const runtime = effectRuntimeSchema.parse({
    id: `${type}-1`,
    creatorId: "attacker",
    targetId: "defender",
    level: 0,
    isNew: false,
    castThisRound: false,
    createdRound: 0,
    longitude: 0,
    latitude: 0,
    barrierAbsorb: 0,
    actionId: `${type}-action`,
    ...runtimeFields,
  });

  return {
    ...makeTag(type, tagFields),
    ...runtime,
  } as UserEffect;
};

export const makeDamageEffect = (
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  makeEffect(
    "damage",
    {
      power: 40,
      calculation: "formula",
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      elements: [],
      ...(overrides as TagFields<"damage">),
    },
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

export const makeDamageModifierEffect = (params: {
  id?: string;
  targetId: string;
  type: DamageModifierType;
  creatorId?: string;
  fromType?: UserEffect["fromType"];
  rounds?: number;
  power?: number;
  calculation?: "static" | "percentage";
  tag?: TagFields<DamageModifierType>;
  runtime?: EffectRuntimeOverrides;
}): UserEffect =>
  makeEffect(
    params.type,
    {
      power: params.power ?? 10,
      rounds: params.rounds ?? 10,
      calculation: params.calculation ?? "percentage",
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      ...params.tag,
    } as TagFields<typeof params.type>,
    {
      id: params.id ?? `${params.type}-${params.targetId}`,
      creatorId: params.creatorId ?? params.targetId,
      targetId: params.targetId,
      level: 0,
      isNew: false,
      castThisRound: false,
      createdRound: 0,
      longitude: 0,
      latitude: 0,
      barrierAbsorb: 0,
      actionId: params.id ?? `${params.type}-action`,
      fromType: params.fromType,
      ...params.runtime,
    },
  );

export const makeDamageTakenEffect = (params: {
  id: string;
  targetId: string;
  type: "decreasedamagetaken" | "increasedamagetaken";
  fromType?: UserEffect["fromType"];
  rounds?: number;
  power?: number;
}): UserEffect =>
  makeDamageModifierEffect({
    ...params,
    creatorId: params.targetId,
    runtime: { actionId: params.id },
  });

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

  addUser(id: string, overrides: BattleUserOverrides = {}) {
    const user = makeBattleUser(id, overrides);
    this.users.set(user.userId, user);
    this.preBattleGearModifiers[user.userId] ??= gearMods();
    return this;
  }

  addEffect(effect: UserEffect): this;
  addEffect<T extends TagType>(
    type: T,
    tagFields?: TagFields<T>,
    runtimeFields?: EffectRuntimeOverrides,
  ): this;
  addEffect<T extends TagType>(
    effectOrType: UserEffect | T,
    tagFields: TagFields<T> = {},
    runtimeFields: EffectRuntimeOverrides = {},
  ) {
    const effect =
      typeof effectOrType === "string"
        ? makeEffect(effectOrType, tagFields, runtimeFields)
        : effectOrType;
    this.effects.push(effect);
    return this;
  }

  setGearModifiers(userId: string, modifiers: Partial<PreBattleGearModifiers>) {
    this.preBattleGearModifiers[userId] = gearMods(modifiers);
    return this;
  }

  clearPositive(targetId: string) {
    const target = this.getUser(targetId);
    const effect = makeEffect(
      "clear",
      { power: 100 },
      {
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
      },
    );
    return clear(effect, this.effects, target);
  }

  cleanseNegative(targetId: string) {
    const target = this.getUser(targetId);
    const effect = makeEffect(
      "cleanse",
      { power: 100 },
      {
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
      },
    );
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

  getUser(id: string) {
    const user = this.users.get(id);
    if (!user) throw new Error(`User not found: ${id}`);
    return user;
  }
}

export const battleScenario = () => new BattleScenario();
