import { z } from "zod";
import { GenNames, StatNames } from "@/libs/combat/constants";
import { emptyPreBattleGearModifiers, computeDamagePacket } from "@/libs/combat/process";
import { clear, cleanse } from "@/libs/combat/tags";
import type {
  ActionEffect,
  BattleBasicAction,
  BattleUserItem,
  BattleUserJutsu,
  BattleUserState,
  CompleteBattle,
  ExtraState,
  GroundEffect,
  PreBattleGearModifiers,
  ReturnedBattle,
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
  "sageMode",
  "sageModeAfter",
] as const satisfies readonly NonNullable<UserEffect["fromType"]>[];

const statNameSchema = z.enum(StatNames);
const genNameSchema = z.enum(GenNames);
/** Builds a number schema with coercion and a test-fixture prefault. */
const num = (value = 0) => z.coerce.number().prefault(value);
/** Builds a boolean schema with a test-fixture prefault. */
const bool = (value = false) => z.boolean().prefault(value);
/** Builds a string schema with a test-fixture prefault. */
const str = (value: string) => z.string().prefault(value);

/**
 * Creates a record from a constant key list where every key has the same value.
 */
const recordWith = <Key extends string, Value>(
  keys: readonly Key[],
  value: Value,
): Record<Key, Value> =>
  Object.fromEntries(keys.map((key) => [key, value])) as Record<Key, Value>;

/**
 * Creates numeric Zod fields for every key in a constant key list.
 */
const numberFields = (keys: readonly string[], defaultValue = 0) =>
  Object.fromEntries(keys.map((key) => [key, num(defaultValue)])) as z.ZodRawShape;

/**
 * Turns a defaults object into a Zod shape by applying one schema builder per
 * field.
 */
const shapeFromDefaults = <Value>(
  defaults: Record<string, Value>,
  schema: (value: Value) => z.ZodType,
) =>
  Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, schema(value)]),
  ) as z.ZodRawShape;

const usedStatDefaults = recordWith(StatNames, 0);
const usedGeneralDefaults = recordWith(GenNames, 0);
const battleUserNumberDefaults = {
  level: 100,
  experience: 0,
  longitude: 0,
  latitude: 0,
  curHealth: 5000,
  maxHealth: 5000,
  curChakra: 5000,
  maxChakra: 5000,
  curStamina: 5000,
  maxStamina: 5000,
  actionPoints: 100,
  round: 1,
  originalLevel: 100,
  originalMoney: 0,
  originalLongitude: 0,
  originalLatitude: 0,
  moneyStolen: 0,
  initiative: 0,
};
const battleUserBooleanDefaults = {
  isAggressor: false,
  iAmHere: true,
  isOriginal: true,
  leftBattle: false,
  fledBattle: false,
  allyVillage: false,
};

/**
 * Zod-backed test fixture schema for battle users.
 *
 * The schema intentionally covers the combat fields most tests need while using
 * `.passthrough()` so a test can still provide uncommon `BattleUserState`
 * fields without expanding this helper first.
 */
export const battleUserSchema = z
  .object({
    ...numberFields(StatNames, 450_000),
    ...numberFields(GenNames, 100_000),
    ...shapeFromDefaults(battleUserNumberDefaults, num),
    ...shapeFromDefaults(battleUserBooleanDefaults, bool),
    userId: str("user"),
    controllerId: str("user"),
    username: str("user"),
    gender: str("Male"),
    villageId: str("village-1"),
    direction: z.enum(["left", "right"]).prefault("left"),
    highestOffence: statNameSchema.prefault("ninjutsuOffence"),
    highestDefence: statNameSchema.prefault("ninjutsuDefence"),
    highestGenerals: z.array(genNameSchema).prefault(["strength", "intelligence"]),
    usedGenerals: z.record(genNameSchema, num()).prefault(usedGeneralDefaults),
    usedStats: z.record(statNameSchema, num()).prefault(usedStatDefaults),
    usedActions: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(["jutsu", "item", "basic", "bloodline"]),
        })
        .passthrough(),
    ).prefault([]),
    usedTagTypes: z.array(z.string()).prefault([]),
    damageDealt: num(),
    basicActions: z.array(z.custom<BattleBasicAction>()).prefault([]),
    relationIds: z.array(z.string()).prefault([]),
    warIds: z.array(z.string()).prefault([]),
    items: z.array(z.custom<BattleUserItem>()).prefault([]),
    jutsus: z.array(z.custom<BattleUserJutsu>()).prefault([]),
  })
  .passthrough();

const effectRuntimeSchema = z
  .object({
    id: str("effect-1"),
    creatorId: str("attacker"),
    targetId: str("defender"),
    level: num(),
    isNew: bool(),
    castThisRound: bool(),
    createdRound: num(),
    longitude: num(),
    latitude: num(),
    barrierAbsorb: num(),
    actionId: str("effect-action"),
    fromType: z.enum(effectSourceTypes).optional(),
  })
  .passthrough();

/**
 * Creates a full `BattleUserState` fixture with stable combat defaults.
 *
 * Use this when code under test expects the real battle-user shape. Pass only
 * the fields relevant to the scenario; unset stats, pools, position, usage
 * tracking, and identity fields are filled with schema defaults.
 */
export const makeBattleUser = (
  id: string,
  overrides: BattleUserOverrides = {},
): BattleUserState => {
  const longitude = Number(overrides.longitude ?? (id === "attacker" ? 0 : 1));

  return battleUserSchema.parse({
    controllerId: id,
    username: id,
    direction: id === "attacker" ? "left" : "right",
    isAggressor: id === "attacker",
    longitude,
    originalLongitude: longitude,
    ...overrides,
    usedGenerals: { ...usedGeneralDefaults, ...overrides.usedGenerals },
    usedStats: { ...usedStatDefaults, ...overrides.usedStats },
    userId: id,
  }) as BattleUserState;
};

/**
 * Convenience wrapper for formula tests that stores the user id inside the
 * override object. Prefer `makeBattleUser(id, overrides)` when the id is already
 * a separate part of the scenario setup.
 */
export const makeUser = (overrides: BattleUserOverrides = {}): BattleUserState =>
  makeBattleUser(String(overrides.userId ?? "user"), overrides);

/**
 * Parses a raw combat tag through the production tag schema for its type.
 *
 * This is useful when building static content fixtures such as jutsu or item
 * definitions, where the effect has not yet been realized into a `UserEffect`.
 */
export const makeTag = <T extends TagType>(
  type: T,
  fields: TagFields<T> = {},
): TagFor<T> => getTagSchema(type).parse({ type, ...fields }) as TagFor<T>;

/**
 * Creates a realized `UserEffect` by combining a parsed combat tag with runtime
 * battle metadata such as creator, target, round, location, and source type.
 */
export const makeEffect = <T extends TagType>(
  type: T,
  tagFields: TagFields<T> = {},
  runtimeFields: EffectRuntimeOverrides = {},
): UserEffect => {
  const runtime = effectRuntimeSchema.parse({
    id: `${type}-1`,
    actionId: `${type}-action`,
    ...runtimeFields,
  });

  return {
    ...runtime,
    ...makeTag(type, tagFields),
  } as UserEffect;
};

/**
 * Creates the default formula damage effect used by damage-pipeline tests.
 *
 * Overrides may include either tag fields, such as `power` or `statTypes`, or
 * runtime fields, such as `creatorId`, `targetId`, and `castThisRound`.
 */
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
      level: 1,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      actionId: "damage-action",
      ...overrides,
    },
  );

/**
 * Creates one of the damage modifier effects that participate in the staged
 * damage pipeline.
 *
 * The helper defaults to an in-battle percentage modifier scoped to Ninjutsu,
 * while still allowing tests to override source type, calculation mode, rounds,
 * runtime metadata, and parsed tag fields.
 */
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
      actionId: params.id ?? `${params.type}-action`,
      fromType: params.fromType,
      ...params.runtime,
    },
  );

/**
 * Backwards-compatible shortcut for damage-taken modifiers used by the
 * clear/cleanse regression tests.
 */
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

/**
 * Builds a complete pre-battle gear modifier record with zero defaults.
 */
export const gearMods = (
  overrides: Partial<PreBattleGearModifiers> = {},
): PreBattleGearModifiers => ({
  ...emptyPreBattleGearModifiers(),
  ...overrides,
});

/**
 * Standard attacker/defender gear fixture used by damage modifier tests.
 */
export const defaultTestGearModifiers = (): Record<
  string,
  PreBattleGearModifiers
> => ({
  attacker: gearMods({ incDamageGivenFromGear: 18.9 }),
  defender: gearMods({ drTakenFromGear: 5 }),
});

/**
 * Creates a battle fixture with one weapon in `extraState.items`.
 *
 * The default weapon has a 22 EP formula damage tag with per-level scaling set,
 * matching the weapon regression that ensures item actions do not inherit
 * character level scaling.
 */
export const makeBattleWithWeapon = (params: {
  itemId?: string;
  damage?: TagFields<"damage">;
  item?: Record<string, unknown>;
} = {}): ReturnedBattle => {
  const weaponId = params.itemId ?? "weapon-1";
  const weapon = {
    id: weaponId,
    name: "Regression Weapon",
    image: "/weapon.png",
    battleDescription: "",
    itemType: "WEAPON",
    target: "OTHER_USER",
    method: "SINGLE",
    range: 1,
    healthCost: 0,
    healthCostReducePerLvl: 0,
    chakraCost: 0,
    chakraCostReducePerLvl: 0,
    staminaCost: 0,
    staminaCostReducePerLvl: 0,
    actionCostPerc: 40,
    cooldown: 0,
    maxDurability: 100,
    effects: [
      makeTag("damage", {
        power: 22,
        powerPerLevel: 1,
        calculation: "formula",
        statTypes: ["Highest"],
        generalTypes: ["Highest"],
        ...params.damage,
      }),
    ],
    ...params.item,
  };

  return {
    extraState: {
      items: { [String(weapon.id)]: weapon },
    },
  } as unknown as ReturnedBattle;
};

type MakeCompleteBattleInput = {
  usersState?: BattleUserState[];
  usersEffects?: UserEffect[];
  groundEffects?: GroundEffect[];
  extraState?: Partial<ExtraState>;
} & Partial<
  Omit<CompleteBattle, "usersState" | "usersEffects" | "groundEffects" | "extraState">
>;

/**
 * Minimal `CompleteBattle` for unit tests. Combat helpers only read a handful of
 * fields; the rest are filled with COMBAT defaults and cast through, matching the
 * per-suite `makeBattle` fixtures this replaces.
 */
export const makeCompleteBattle = (
  overrides: MakeCompleteBattleInput = {},
): CompleteBattle => {
  const { extraState, ...rest } = overrides;
  return {
    id: "battle-1",
    battleType: "COMBAT",
    round: 1,
    usersState: [],
    usersEffects: [],
    groundEffects: [],
    extraState: extraState ?? {},
    ...rest,
  } as unknown as CompleteBattle;
};

/**
 * COMBAT battle for injected-jutsu tests (`handleInjectedJutsus`,
 * `availableUserActions`). Pass any injectable jutsu map on `extraState.jutsus`;
 * this is not tied to a single feature catalog.
 *
 * @param users - One user or the full `usersState` array.
 * @param extraState - Typically `{ jutsus: { [id]: jutsu } }`, plus any other
 *   static catalogs the action builder looks up (items, sage modes, …).
 * @param overrides - Round, effects, battle type, etc.
 */
export const makeInjectBattle = (
  users: BattleUserState | BattleUserState[],
  extraState: Partial<ExtraState> = {},
  overrides: Omit<MakeCompleteBattleInput, "usersState" | "extraState"> = {},
): CompleteBattle =>
  makeCompleteBattle({
    usersState: Array.isArray(users) ? users : [users],
    extraState,
    ...overrides,
  });

/**
 * Creates the dynamic user-item reference for the default weapon fixture.
 */
export const makeBattleUserItem = (
  overrides: Partial<BattleUserItem> = {},
): BattleUserItem => ({
  id: "user-item-1",
  itemId: "weapon-1",
  quantity: 1,
  equipped: "HAND_1",
  durability: 100,
  dropChancePerc: 0,
  lastUsedRound: 0,
  originalCooldown: 0,
  ...overrides,
});

/**
 * Chainable test harness for battle-level setup.
 *
 * The scenario owns users, active user effects, per-user gear modifiers, and
 * the battle round. Use it for scenarios that need multiple users/effects or
 * need to run the same production helper against a coherent battle state.
 */
export type BattleScenario = {
  users: Map<string, BattleUserState>;
  effects: UserEffect[];
  preBattleGearModifiers: Record<string, PreBattleGearModifiers>;
  round: number;
  addUser: (id: string, overrides?: BattleUserOverrides) => BattleScenario;
  addEffect: {
    (effect: UserEffect): BattleScenario;
    <T extends TagType>(
      type: T,
      tagFields?: TagFields<T>,
      runtimeFields?: EffectRuntimeOverrides,
    ): BattleScenario;
  };
  setGearModifiers: (
    userId: string,
    modifiers: Partial<PreBattleGearModifiers>,
  ) => BattleScenario;
  clearPositive: (targetId: string) => ActionEffect;
  cleanseNegative: (targetId: string) => ActionEffect;
  computeDamage: (rawDamage?: number, damageEffect?: UserEffect) => number;
  getEffect: (id: string) => UserEffect;
  getUser: (id: string) => BattleUserState;
};

/**
 * Creates the default attacker-vs-defender battle scenario.
 */
export const battleScenario = (): BattleScenario => {
  const users = new Map<string, BattleUserState>();
  const effects: UserEffect[] = [];
  const preBattleGearModifiers: Record<string, PreBattleGearModifiers> = {};

  const applyBasicEffect = (
    type: Extract<TagType, "clear" | "cleanse">,
    applyEffect: typeof clear,
    targetId: string,
  ) => {
    const target = scenario.getUser(targetId);
    const effect = makeEffect(
      type,
      { power: 100 },
      {
        id: `${type}-${targetId}`,
        targetId,
        isNew: true,
        castThisRound: true,
        createdRound: scenario.round,
        longitude: target.longitude,
        latitude: target.latitude,
        actionId: type,
        fromType: "basic",
      },
    );
    return applyEffect(effect, effects, target);
  };

  const scenario: BattleScenario = {
    users,
    effects,
    preBattleGearModifiers,
    round: 1,
    addUser: (id, overrides = {}) => {
      const user = makeBattleUser(id, overrides);
      users.set(user.userId, user);
      preBattleGearModifiers[user.userId] ??= gearMods();
      return scenario;
    },
    addEffect: ((
      effectOrType: UserEffect | TagType,
      tagFields: TagFields<TagType> = {},
      runtimeFields: EffectRuntimeOverrides = {},
    ) => {
      const effect =
        typeof effectOrType === "string"
          ? makeEffect(
              effectOrType,
              tagFields as TagFields<typeof effectOrType>,
              runtimeFields,
            )
          : effectOrType;
      effects.push(effect);
      return scenario;
    }) as BattleScenario["addEffect"],
    setGearModifiers: (userId, modifiers) => {
      preBattleGearModifiers[userId] = gearMods(modifiers);
      return scenario;
    },
    clearPositive: (targetId) => applyBasicEffect("clear", clear, targetId),
    cleanseNegative: (targetId) => applyBasicEffect("cleanse", cleanse, targetId),
    computeDamage: (rawDamage = 1000, damageEffect = makeDamageEffect()) =>
      computeDamagePacket({
        rawDamage,
        damageEffect,
        usersEffects: effects,
        attackerId: damageEffect.creatorId,
        defenderId: damageEffect.targetId,
        preBattleGearModifiers,
        battleRound: scenario.round,
      }).damage,
    getEffect: (id) => {
      const effect = effects.find((e) => e.id === id);
      if (!effect) throw new Error(`Effect not found: ${id}`);
      return effect;
    },
    getUser: (id) => {
      const user = users.get(id);
      if (!user) throw new Error(`User not found: ${id}`);
      return user;
    },
  };

  scenario.addUser("attacker");
  scenario.addUser("defender");

  return scenario;
};
