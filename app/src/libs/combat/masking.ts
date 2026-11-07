import {
  ID_ANIMATION_HEAL,
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  ID_SFX_CLEANSE,
  ID_SFX_CLEAR,
  ID_SFX_HEAL,
  ID_SFX_HIT,
  ID_SFX_MOVE,
  ID_SFX_SMOKE,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
} from "@/drizzle/constants";
import type { Battle } from "@/drizzle/schema";
import { isSummonTemplate } from "@/libs/combat/summon";
import type { BattleEffect } from "@/libs/combat/types";
import type { ZodAllTags } from "@/validators/combat";
import { allState, publicState } from "./constants";
import type {
  BattleUserState,
  ReturnedBattle,
  ReturnedExtraState,
  ReturnedUserState,
} from "./types";

/** Masks the response without changing the authoritative battle used by combat. */
export const maskBattle = (battle: Battle, userId: string): ReturnedBattle => ({
  ...battle,
  extraState: maskBattleExtraState(battle, userId),
  usersState: maskUsersState(battle.usersState, userId),
  usersEffects: maskBattleEffects(battle.usersEffects, battle, userId),
  groundEffects: maskBattleEffects(battle.groundEffects, battle, userId),
});

/**
 * Masks user state to hide private information from other players.
 * Returns public state for opponents and full state for the session user.
 */
export const maskUsersState = (
  usersState: BattleUserState[],
  userId: string,
): ReturnedUserState[] => {
  return usersState
    .filter((user) => !isSummonTemplate(user, usersState))
    .map((user) => {
      if (user.controllerId !== userId) {
        return Object.fromEntries(
          publicState.map((key) => [key, user[key]]),
        ) as unknown as ReturnedUserState;
      } else {
        return Object.fromEntries(
          allState.map((key) => [key, user[key]]),
        ) as unknown as ReturnedUserState;
      }
    });
};

/**
 * Send only catalogs needed for the viewer's actions and actions already revealed
 * in the combat log. An allowlist keeps new server-only state private by default.
 */
const maskBattleExtraState = (battle: Battle, userId: string): ReturnedExtraState => {
  const state = battle.extraState;
  const visibleUsers = battle.usersState.filter(
    (u) => !isSummonTemplate(u, battle.usersState),
  );
  const controlledUsers = visibleUsers.filter((u) => u.controllerId === userId);
  const jutsuIds = new Set(
    controlledUsers.flatMap(
      (u) =>
        u.jutsus?.flatMap((j) => [
          j.jutsuId,
          ...(j.linkedReskinId ? [j.linkedReskinId] : []),
        ]) ?? [],
    ),
  );
  const itemIds = new Set(
    controlledUsers.flatMap((u) => u.items?.map((i) => i.itemId) ?? []),
  );
  const reskinIds = new Set(
    controlledUsers.flatMap((u) => u.jutsus?.map((j) => j.reskinId) ?? []),
  );
  const sageModeIds = new Set(controlledUsers.map((u) => u.sageModeId));

  for (const id of state?.revealedActions?.jutsuIds ?? []) jutsuIds.add(id);
  for (const id of state?.revealedActions?.itemIds ?? []) itemIds.add(id);

  // Injected actions can become available after the initial fetch, including on a
  // newly piloted summon. Include their definitions only once granted to the viewer.
  for (const effect of battle.usersEffects ?? []) {
    if (
      effect.type === "injectjutsus" &&
      controlledUsers.some((u) => u.userId === effect.targetId)
    ) {
      for (const id of effect.jutsuIds) jutsuIds.add(id);
    }
  }
  if (controlledUsers.some((u) => u.sageModeId))
    jutsuIds.add(SAGE_MODE_ACTIVATION_JUTSU_ID);
  for (const user of battle.usersState) {
    for (const action of user.usedActions) {
      if (action.type === "jutsu") jutsuIds.add(action.id);
      if (action.type === "item") itemIds.add(action.id);
    }
  }

  const select = <T>(
    catalog: Record<string, T> | undefined,
    ids: Set<string | null | undefined>,
  ) => Object.fromEntries(Object.entries(catalog ?? {}).filter(([id]) => ids.has(id)));
  // Passive realization stamps private stat metadata onto catalog tags. Copy
  // those definitions before stripping it so combat retains its runtime data.
  const maskCatalogEffects = <T extends { effects: ZodAllTags[] }>(
    catalog: Record<string, T>,
  ) =>
    Object.fromEntries(
      Object.entries(catalog).map(([id, definition]) => [
        id,
        {
          ...definition,
          effects: definition.effects.map((effect) => {
            const masked = { ...effect } as BattleEffect;
            delete masked.highestGenerals;
            // Persisted catalog tags can contain private target metadata outside the runtime type.
            Reflect.deleteProperty(masked, "targetHighestGenerals");
            return masked;
          }),
        },
      ]),
    );
  const jutsus = select(state?.jutsus, jutsuIds);
  const items = maskCatalogEffects(select(state?.items, itemIds));
  const effects = [
    ...Object.values(jutsus).flatMap((j) => j.effects),
    ...Object.values(items).flatMap((i) => i.effects),
    ...maskBattleEffects(battle.usersEffects, battle, userId),
    ...maskBattleEffects(battle.groundEffects, battle, userId),
  ];

  return {
    kageMatch: state?.kageMatch,
    tournamentGameId: state?.tournamentGameId,
    tournamentAiOnly: state?.tournamentAiOnly,
    encounter: state?.encounter ? { wave: state.encounter.wave } : undefined,
    // Pending wave templates include private loadouts; expose only the party's current progress.
    dungeon: state?.dungeon
      ? {
          runId: state.dungeon.runId,
          expiresAt: state.dungeon.expiresAt,
        }
      : undefined,
    jutsus,
    items,
    jutsuReskins: select(state?.jutsuReskins, reskinIds),
    sageModes: select(state?.sageModes, sageModeIds),
    villages: Object.fromEntries(
      Object.entries(
        select(state?.villages, new Set(visibleUsers.map((u) => u.villageId))),
      ).map(([id, village]) => [id, { id, hexColor: village.hexColor }]),
    ),
    clans: Object.fromEntries(
      Object.entries(
        select(state?.clans, new Set(visibleUsers.map((u) => u.clanId))),
      ).map(([id, clan]) => [id, { id, image: clan.image }]),
    ),
    bloodlines: Object.fromEntries(
      Object.entries(
        maskCatalogEffects(
          select(state?.bloodlines, new Set(visibleUsers.map((u) => u.bloodlineId))),
        ),
      ).map(([id, line]) => {
        const { bloodrightTiers: _tiers, ...bloodline } = line as typeof line & {
          bloodrightTiers?: unknown;
        };
        return [id, bloodline];
      }),
    ),
    enemySkills: {},
    anbuSquads: {},
    keystoneItems: maskCatalogEffects(
      select(state?.keystoneItems, new Set(visibleUsers.map((u) => u.keystoneItemId))),
    ),
    wars: {},
    aiProfiles: {},
    relations: {},
    profileCacheSnapshots: {},
    userQuests: {},
    completedQuests: {},
    questData: {},
    bounties: {},
    bountySignups: {},
    sectorExclusiveRaids: [],
    energyRegeneration: select(state?.energyRegeneration, new Set([userId])),
    energyRegenerationPeriods: select(
      state?.energyRegenerationPeriods,
      new Set([userId]),
    ),
    textureAssets: [
      ...new Set([
        ID_ANIMATION_SMOKE,
        ID_ANIMATION_HIT,
        ID_ANIMATION_HEAL,
        ...effects
          .flatMap((e) => [
            e.appearAnimation,
            e.disappearAnimation,
            e.staticAnimation,
            e.staticAssetPath,
          ])
          .filter((id): id is string => !!id),
      ]),
    ],
    sfxAssets: [
      ...new Set([
        ID_SFX_SMOKE,
        ID_SFX_HIT,
        ID_SFX_HEAL,
        ID_SFX_MOVE,
        ID_SFX_CLEANSE,
        ID_SFX_CLEAR,
        ...effects
          .flatMap((e) => [e.appearSfx, e.disappearSfx])
          .filter((id): id is string => !!id),
      ]),
    ],
  };
};

/** Preserve visible effects while removing private equipment/skill sources and grants. */
const maskBattleEffects = <T extends BattleEffect>(
  effects: T[] | undefined,
  battle: Battle,
  userId: string,
): T[] => {
  const controlledIds = new Set(
    battle.usersState.filter((u) => u.controllerId === userId).map((u) => u.userId),
  );
  const templateIds = new Set(
    battle.usersState
      .filter((u) => isSummonTemplate(u, battle.usersState))
      .map((u) => u.userId),
  );
  return (effects ?? [])
    .filter(
      (effect) =>
        !templateIds.has(effect.creatorId) &&
        !("targetId" in effect && templateIds.has(String(effect.targetId))),
    )
    .map((effect) => {
      const masked = { ...effect };
      if (!controlledIds.has(effect.creatorId)) delete masked.highestGenerals;
      // Saved effects can carry unused target stats; omit them from every response.
      Reflect.deleteProperty(masked, "targetHighestGenerals");
      return {
        ...masked,
        // Passive modifiers are visible in the effects panel; their equipment and
        // skill IDs are not needed to render or apply those modifiers on the client.
        ...(!controlledIds.has(effect.creatorId) &&
        ["armor", "accessory", "skill"].includes(effect.fromType ?? "")
          ? { actionId: "hidden" }
          : {}),
        ...(effect.type === "injectjutsus" &&
        !("targetId" in effect && controlledIds.has(String(effect.targetId)))
          ? { jutsuIds: [] }
          : {}),
      };
    });
};
