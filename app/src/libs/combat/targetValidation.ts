import type { Grid } from "honeycomb-grid";
import {
  actionPointsAfterAction,
  calcActiveUser,
  getRemainingCooldown,
} from "@/libs/combat/actions";
import type {
  CombatAction,
  ReturnedBattle,
  ReturnedUserState,
} from "@/libs/combat/types";
import { getActionAffectedTiles } from "@/libs/combat/util";
import type { TerrainHex } from "@/libs/hexgrid";
import { getPossibleActionTiles } from "@/libs/hexgrid";

/** Shared by interaction and highlights so desktop and touch use identical target rules. */
export const validateActionTarget = (
  info: TargetCheck,
): {
  isValid: boolean;
  origin?: TerrainHex;
  possibleTiles?: Grid<TerrainHex>;
  greenTiles?: Set<TerrainHex>;
  redTiles?: Set<TerrainHex>;
} => {
  const { user, battle, action, timeDiff } = info;

  // No action selected
  if (!action) return { isValid: false };

  // Check if user is the active actor. `user` here is the actor the human
  // controls (self, or piloted summon on its turn — callers pass the controlled
  // actor), and precomputedUserId is keyed to that same actor, so this correctly
  // permits a piloted summon to target on its own turn.
  const { actor } = calcActiveUser(battle, user.userId, timeDiff, {
    precomputedUserId: info.precomputedUserId,
    precomputedActions: info.precomputedActions,
  });
  if (actor.userId !== user.userId) return { isValid: false };

  // Check if user has enough action points
  const { canAct } = actionPointsAfterAction(user, battle, action);
  if (!canAct) return { isValid: false };

  // Check action cooldown
  if (getRemainingCooldown(action, battle.round) > 0) return { isValid: false };

  return aimAction(info);
};

/**
 * Whether the actor, on their turn, aims the selected action at a fighter: the action reaches
 * the fighter's tile even when the actor lacks the action points or the action cools down.
 * Outside the actor's turn nothing is aimed.
 */
export const actionAimsAtFighter = (info: TargetCheck, fighterId: string) => {
  const { user, battle, grid, timeDiff } = info;
  if (!info.action) return false;
  const { actor } = calcActiveUser(battle, user.userId, timeDiff, {
    precomputedUserId: info.precomputedUserId,
    precomputedActions: info.precomputedActions,
  });
  if (actor.userId !== user.userId) return false;
  const fighter = battle.usersState.find((state) => state.userId === fighterId);
  const target =
    fighter && grid.getHex({ col: fighter.longitude, row: fighter.latitude });
  return !!target && aimAction({ ...info, target }).isValid;
};

/** Share target geometry without turn, action-point or cooldown availability gates. */
const aimAction = (info: TargetCheck) => {
  const { user, battle, action, grid, target } = info;
  if (!action) return { isValid: false };

  // Get user's current position
  const origin = grid.getHex({ col: user.longitude, row: user.latitude });
  if (!origin) return { isValid: false };

  // Get possible tiles for the action
  const possibleTiles = getPossibleActionTiles(action, origin, grid);
  if (!possibleTiles) return { isValid: false };

  // Check if target is in possible tiles
  const targetInPossible = possibleTiles.filter((t) => t === target).size > 0;
  if (!targetInPossible) return { isValid: false };

  // Get affected tiles (green = valid, red = invalid)
  const { green: greenTiles, red: redTiles } = getActionAffectedTiles({
    preview: true,
    a: origin,
    b: target,
    action,
    grid,
    restrictGrid: possibleTiles,
    ground: battle.groundEffects,
    userId: user.userId,
    users: battle.usersState,
  });

  // Target must be in green set and not in red set
  const hasCoordinatePattern =
    action.method === "COORDINATES" ||
    action.effects.some((tag) => tag.target === "COORDINATES");
  const isValid =
    greenTiles.size > 0 && (hasCoordinatePattern || !redTiles.has(target));

  return { isValid, origin, possibleTiles, greenTiles, redTiles };
};

type TargetCheck = {
  user: ReturnedUserState;
  battle: ReturnedBattle;
  action: CombatAction | undefined;
  grid: Grid<TerrainHex>;
  target: TerrainHex;
  timeDiff: number;
  precomputedUserId?: string;
  precomputedActions?: CombatAction[];
};
