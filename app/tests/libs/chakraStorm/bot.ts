import { csNoTraining } from "@/libs/chakraStorm/content";
import {
  applyCsAction,
  CS_DIRECTIONS,
  type CsAction,
  type CsRunConfig,
  type CsState,
  createCsRun,
  stepCs,
} from "@/libs/chakraStorm/sim";

const HORIZON: CsRunConfig = { stage: "horizon", training: csNoTraining() };

/**
 * Plays a run with a simple bot: it walks away from nearby raiders and toward orbs, and
 * takes the first card of every draft. Returns the state and the recorded log.
 */
export const playBot = (
  seed: string,
  maxTicks: number,
  config = HORIZON,
  quitAt?: number,
) => {
  const state = createCsRun(seed, config);
  const log: [number, CsAction][] = [];
  const act = (action: CsAction) => {
    if (applyCsAction(state, action)) log.push([state.tick, action]);
  };
  while (!state.over && state.tick < maxTicks) {
    if (quitAt !== undefined && state.tick >= quitAt) {
      act(["quit"]);
      break;
    }
    if (state.draft) {
      act(["pick", 0]);
      continue;
    }
    const move = kiteDirection(state);
    if (move !== state.hero.move) act(["move", move]);
    stepCs(state);
    state.events.length = 0;
  }
  return { state, log };
};

/** Away from raiders within reach, toward orbs nearby, and back toward the middle. */
const kiteDirection = (state: CsState) => {
  const { hero } = state;
  let fx = -hero.x * 0.02,
    fy = -hero.y * 0.02;
  for (const enemy of state.enemies) {
    const dx = hero.x - enemy.x,
      dy = hero.y - enemy.y;
    const squared = dx * dx + dy * dy;
    if (squared < 49) {
      fx += dx / (squared + 0.5);
      fy += dy / (squared + 0.5);
    }
  }
  for (const orb of state.orbs) {
    const dx = orb.x - hero.x,
      dy = orb.y - hero.y;
    const squared = dx * dx + dy * dy;
    if (squared < 36) {
      fx += (dx / (squared + 1)) * 0.3;
      fy += (dy / (squared + 1)) * 0.3;
    }
  }
  let best = -1,
    bestDot = 0.0001;
  CS_DIRECTIONS.forEach((direction, index) => {
    const dot = direction.x * fx + direction.y * fy;
    if (dot > bestDot) {
      bestDot = dot;
      best = index;
    }
  });
  return best;
};
