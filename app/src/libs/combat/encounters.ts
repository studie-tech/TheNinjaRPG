import { nanoid } from "nanoid";
import { stillInBattle } from "@/libs/combat/actions";
import { getBattleSpawnLocations } from "@/libs/combat/participants";
import type {
  BattleUserState,
  CompleteBattle,
  ExtraState,
  UserEffect,
} from "@/libs/combat/types";
import { applyPoolAdjustmentsToBase, mergeExtraState } from "@/libs/combat/util";
import type { BossArrival, EncounterWave } from "@/validators/coop";

/**
 * Advance battle state in place once the preceding enemies and authored round delay are done.
 * Spawn only preloaded combatants and effects; return whether a wave was consumed, without I/O.
 */
export const advanceEncounterWave = (battle: CompleteBattle, ended = false) => {
  const state = battle.extraState.encounter;
  const next = state?.pendingWaves[0];
  if (!state || !next || ended) return false;
  if (battle.usersState.some((u) => u.direction === "right" && stillInBattle(u)))
    return false;
  if (battle.round < state.waveStartedRound + next.delayRounds) return false;
  // Defeated enemies remain as effect sources until the floor settles.
  const occupied = battle.usersState.filter((u) => stillInBattle(u));
  // A transforming enemy leaves no remains: its next form takes over its tile.
  const fallen = next.arrival
    ? battle.usersState.find(
        (u) => u.direction === "right" && !u.isSummon && !u.leftBattle,
      )
    : undefined;
  const locations = getBattleSpawnLocations(
    battle.width,
    battle.height,
    "right",
  ).filter((p) => !occupied.some((u) => u.longitude === p.x && u.latitude === p.y));
  // Moving teammates may occupy the enemy spawn zone; use other unoccupied cells as needed.
  for (let x = 0; x < battle.width; x++)
    for (let y = 0; y < battle.height; y++) {
      if (
        !occupied.some((u) => u.longitude === x && u.latitude === y) &&
        !locations.some((p) => p.x === x && p.y === y)
      )
        locations.push({ x, y });
    }
  if (
    fallen &&
    !occupied.some(
      (u) => u.longitude === fallen.longitude && u.latitude === fallen.latitude,
    )
  )
    locations.unshift({ x: fallen.longitude, y: fallen.latitude });
  const arrivals = next.users.filter((u) => !u.isSummonTemplate);
  arrivals.forEach((u) => {
    const p = locations.shift();
    if (!p) throw new Error("No encounter wave spawn cell");
    u.longitude = p.x;
    u.latitude = p.y;
    u.round = battle.round;
    u.updatedAt = new Date();
    // Barriers cannot occupy spawn cells; other effects persist through the floor.
    battle.groundEffects = battle.groundEffects.filter(
      (e) => e.type !== "barrier" || e.longitude !== p.x || e.latitude !== p.y,
    );
  });
  battle.usersEffects = [...battle.usersEffects, ...next.effects];
  // Turn scheduling walks usersState in descending initiative order.
  battle.usersState = [...battle.usersState, ...next.users].sort(
    (a, b) => b.initiative - a.initiative,
  );
  state.pendingWaves.shift();
  state.wave += 1;
  state.waveStartedRound = battle.round;
  const [form] = arrivals;
  if (fallen && form && next.arrival) {
    fallen.leftBattle = true;
    form.transformation = {
      ...next.arrival,
      id: nanoid(),
      fromUserId: fallen.userId,
    };
  }
  return true;
};

/** Preloaded combatants are private; clients receive only the current wave number. */
export type EncounterWaveState = {
  wave: number;
  waveStartedRound: number;
  pendingWaves: {
    users: BattleUserState[];
    effects: UserEffect[];
    delayRounds: number;
    arrival?: BossArrival;
  }[];
};

/**
 * Prepare future waves during initiation and merge their lookup data into the opening state.
 * Preparation stays ordered because the adapter consumes successive slices of preloaded users.
 * Combat actions later consume these snapshots without fetching enemies or their content.
 */
export const prepareEncounterWaves = async (
  waves: EncounterWave[],
  opening: PreparedEncounterWave,
  prepare: (wave: EncounterWave) => Promise<PreparedEncounterWave>,
): Promise<EncounterWaveState> => {
  captureEncounterSummonTemplates(opening.usersState, opening.userEffects);
  const pendingWaves: EncounterWaveState["pendingWaves"] = [];
  let standing = opening.usersState;
  for (const wave of waves.slice(1)) {
    const prepared = await prepare(wave);
    if (wave.arrival) {
      for (const user of standing)
        if (user.isAi && !user.isSummon && user.direction === "right")
          user.risesAgain = true;
    }
    standing = prepared.usersState;
    captureEncounterSummonTemplates(prepared.usersState, prepared.userEffects);
    mergeExtraState(opening.extraState, prepared.extraState);
    // Gear modifiers belong to each combatant, outside the static catalog merge.
    opening.extraState.preBattleGearModifiers ??= {};
    Object.assign(
      opening.extraState.preBattleGearModifiers,
      prepared.extraState.preBattleGearModifiers,
    );
    prepared.usersState.forEach((user) => {
      applyPoolAdjustmentsToBase(user, prepared.userEffects);
    });
    pendingWaves.push({
      users: prepared.usersState,
      effects: prepared.userEffects,
      delayRounds: wave.delayRounds,
      ...(wave.arrival ? { arrival: wave.arrival } : {}),
    });
  }
  return { wave: 1, waveStartedRound: 0, pendingWaves };
};

/** Keep pristine summon sources from every wave, before their pool adjustments. */
export const captureEncounterSummonTemplates = (
  usersState: BattleUserState[],
  userEffects: UserEffect[],
) => {
  const sources = usersState.filter((u) => u.isAi && !u.isSummon);
  for (const source of sources) {
    const template = {
      ...structuredClone(source),
      userId: nanoid(),
      isSummon: true,
      isSummonTemplate: true,
      curHealth: 0,
    };
    usersState.push(template);
    userEffects.push(
      ...userEffects
        .filter((e) => e.targetId === source.userId)
        .map((e) => ({
          ...structuredClone(e),
          id: nanoid(),
          targetId: template.userId,
          creatorId: e.creatorId === source.userId ? template.userId : e.creatorId,
        })),
    );
  }
};

/** Processed wave snapshot; preparation mutates its arrays to retain pristine summon templates. */
type PreparedEncounterWave = {
  usersState: BattleUserState[];
  userEffects: UserEffect[];
  extraState: ExtraState;
};
