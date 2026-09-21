import {
  FISHING_SIMULATION_STEP_MS,
  FISHING_VISUAL_ENGINE_VERSION,
} from "@/drizzle/constants";
import type { FishBehavior } from "@/libs/fishing";

export type FishingSimulationPhase = "ATTRACT" | "BITE" | "FIGHT" | "LANDED" | "FAILED";

export type FishingSimulationInput = {
  sequence: number;
  durationMs: number;
  rodX: number;
  rodY: number;
  reel: boolean;
  hook: boolean;
};

export type FishingSimulationState = {
  engineVersion: number;
  behavior: FishBehavior;
  modifiers: { attractionBonus: number; controlBonus: number; socialBonus: number };
  seed: number;
  tick: number;
  elapsedMs: number;
  phase: FishingSimulationPhase;
  lastInputSequence: number;
  player: { x: number; y: number };
  lure: { x: number; y: number; velocityX: number; velocityY: number };
  fish: {
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    stamina: number;
    interest: number;
    biteMs: number;
    slackMs: number;
  };
  line: { length: number; tension: number };
  school: { x: number; y: number; proximity: number } | null;
  landingProgress: number;
};

type CreateSimulationInput = {
  sessionId: string;
  behavior: FishBehavior;
  castTarget: { x: number; y: number };
  schoolPoint?: { x: number; y: number } | null;
  modifiers: { attractionBonus: number; controlBonus: number; socialBonus: number };
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const hash = (text: string) =>
  [...text].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0);

const noise = (seed: number, tick: number, channel: number) => {
  let value = (seed ^ Math.imul(tick + channel * 997, 0x45d9f3b)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

const behaviorConfig: Record<
  FishBehavior,
  { approach: number; pull: number; staminaDrain: number; turnRate: number }
> = {
  DARTING: { approach: 0.58, pull: 1.55, staminaDrain: 0.65, turnRate: 2.1 },
  HEAVY: { approach: 0.4, pull: 1.8, staminaDrain: 0.42, turnRate: 0.75 },
  CAUTIOUS: { approach: 0.34, pull: 1.15, staminaDrain: 0.5, turnRate: 1.05 },
  ERRATIC: { approach: 0.48, pull: 1.4, staminaDrain: 0.54, turnRate: 2.65 },
};

export const createFishingSimulation = ({
  sessionId,
  behavior,
  castTarget,
  schoolPoint,
  modifiers,
}: CreateSimulationInput): FishingSimulationState => {
  const seed = hash(`${sessionId}:${behavior}`);
  const lure = {
    x: clamp(castTarget.x, 120, 880),
    y: clamp(castTarget.y, 90, 650),
    velocityX: 0,
    velocityY: 0,
  };
  const angle = noise(seed, 0, 1) * Math.PI * 2;
  const distance = 170 + noise(seed, 0, 2) * 110;
  const school = schoolPoint
    ? {
        x: clamp(schoolPoint.x, 80, 920),
        y: clamp(schoolPoint.y, 70, 670),
        proximity: clamp(
          1 - Math.hypot(lure.x - schoolPoint.x, lure.y - schoolPoint.y) / 320,
          0,
          1,
        ),
      }
    : null;
  return {
    engineVersion: FISHING_VISUAL_ENGINE_VERSION,
    behavior,
    modifiers,
    seed,
    tick: 0,
    elapsedMs: 0,
    phase: "ATTRACT",
    lastInputSequence: 0,
    player: { x: 500, y: 910 },
    lure,
    fish: {
      x: clamp(lure.x + Math.cos(angle) * distance, 60, 940),
      y: clamp(lure.y + Math.sin(angle) * distance, 50, 690),
      velocityX: 0,
      velocityY: 0,
      stamina: 100,
      interest: 0,
      biteMs: 0,
      slackMs: 0,
    },
    line: {
      length: Math.hypot(lure.x - 500, lure.y - 910),
      tension: 18,
    },
    school,
    landingProgress: 0,
  };
};

export const advanceFishingSimulation = (
  current: FishingSimulationState,
  input: FishingSimulationInput,
  behavior: FishBehavior,
  modifiers: { attractionBonus: number; controlBonus: number; socialBonus: number },
) => {
  if (
    current.phase === "LANDED" ||
    current.phase === "FAILED" ||
    input.sequence <= current.lastInputSequence
  )
    return current;
  const state = structuredClone(current);
  const durationMs = clamp(
    Math.round(input.durationMs / FISHING_SIMULATION_STEP_MS) *
      FISHING_SIMULATION_STEP_MS,
    FISHING_SIMULATION_STEP_MS,
    FISHING_SIMULATION_STEP_MS * 4,
  );
  const steps = durationMs / FISHING_SIMULATION_STEP_MS;
  for (let step = 0; step < steps; step++) {
    advanceStep(state, input, behavior, modifiers);
    if (state.phase === "LANDED" || state.phase === "FAILED") break;
  }
  state.lastInputSequence = input.sequence;
  return state;
};

const advanceStep = (
  state: FishingSimulationState,
  input: FishingSimulationInput,
  behavior: FishBehavior,
  modifiers: { attractionBonus: number; controlBonus: number; socialBonus: number },
) => {
  state.tick += 1;
  state.elapsedMs += FISHING_SIMULATION_STEP_MS;
  const config = behaviorConfig[behavior];
  const rodX = clamp(input.rodX, -1, 1);
  const rodY = clamp(input.rodY, -1, 1);
  const lureSpeed = state.phase === "FIGHT" ? 2.4 : 1.35;
  state.lure.velocityX = state.lure.velocityX * 0.78 + rodX * lureSpeed;
  state.lure.velocityY = state.lure.velocityY * 0.78 + rodY * lureSpeed;
  state.lure.x = clamp(state.lure.x + state.lure.velocityX, 70, 930);
  state.lure.y = clamp(state.lure.y + state.lure.velocityY, 55, 720);

  if (state.phase === "ATTRACT") {
    const dx = state.lure.x - state.fish.x;
    const dy = state.lure.y - state.fish.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const wobble = (noise(state.seed, state.tick, 3) - 0.5) * config.turnRate;
    state.fish.velocityX =
      state.fish.velocityX * 0.84 + (dx / distance) * config.approach + wobble;
    state.fish.velocityY =
      state.fish.velocityY * 0.84 + (dy / distance) * config.approach - wobble * 0.35;
    state.fish.x = clamp(state.fish.x + state.fish.velocityX, 45, 955);
    state.fish.y = clamp(state.fish.y + state.fish.velocityY, 40, 730);
    const presentation = clamp(
      1 - Math.abs(Math.hypot(state.lure.velocityX, state.lure.velocityY) - 0.8) / 2,
      0.45,
      1,
    );
    const nearLure = clamp(1 - distance / 330, 0.08, 1);
    const bonus = (modifiers.attractionBonus + modifiers.socialBonus) / 100;
    state.fish.interest = clamp(
      state.fish.interest +
        (0.72 + bonus * 0.6 + (state.school?.proximity ?? 0) * 0.16) *
          presentation *
          nearLure,
      0,
      100,
    );
    if (state.fish.interest >= 100) {
      state.phase = "BITE";
      state.fish.biteMs = 0;
      state.line.tension = 24;
    }
  } else if (state.phase === "BITE") {
    state.fish.biteMs += FISHING_SIMULATION_STEP_MS;
    state.line.tension = 28 + Math.sin(state.tick * 0.8) * 8;
    if (input.hook) {
      state.phase = "FIGHT";
      state.fish.stamina = 100;
      state.line.tension = 42;
    } else if (state.fish.biteMs > 1_600) {
      state.phase = "ATTRACT";
      state.fish.interest = 72;
      state.line.tension = 16;
    }
  } else if (state.phase === "FIGHT") {
    const runAngle =
      noise(state.seed, Math.floor(state.tick / 10), 4) * Math.PI * 2 +
      Math.sin(state.tick * 0.05 * config.turnRate);
    const runX = Math.cos(runAngle);
    const runY = Math.sin(runAngle);
    state.fish.velocityX = state.fish.velocityX * 0.72 + runX * config.pull;
    state.fish.velocityY = state.fish.velocityY * 0.72 + runY * config.pull;
    state.fish.x = clamp(state.fish.x + state.fish.velocityX, 35, 965);
    state.fish.y = clamp(state.fish.y + state.fish.velocityY, 35, 745);
    const alignment = clamp(-(rodX * runX + rodY * runY), -1, 1);
    const control = clamp(modifiers.controlBonus / 25, 0, 0.6);
    const pressure = config.pull * 0.78 - alignment * 0.65 - control;
    state.line.tension = clamp(
      state.line.tension + pressure + (input.reel ? 1.05 : -0.9),
      0,
      120,
    );
    if (input.reel && state.line.tension > 12 && state.line.tension < 92) {
      state.fish.stamina = clamp(
        state.fish.stamina - config.staminaDrain * (1 + alignment * 0.18 + control),
        0,
        100,
      );
      state.line.length = Math.max(100, state.line.length - 1.8);
    } else {
      state.line.length = Math.min(900, state.line.length + 0.45);
    }
    state.fish.slackMs =
      state.line.tension < 4
        ? state.fish.slackMs + FISHING_SIMULATION_STEP_MS
        : Math.max(0, state.fish.slackMs - FISHING_SIMULATION_STEP_MS * 2);
    const distanceProgress = clamp((700 - state.line.length) / 4, 0, 100);
    state.landingProgress = Math.round(
      (100 - state.fish.stamina) * 0.75 + distanceProgress * 0.25,
    );
    if (state.line.tension >= 100 || state.fish.slackMs >= 2_500)
      state.phase = "FAILED";
    else if (state.fish.stamina <= 0 && state.line.length <= 280) {
      state.phase = "LANDED";
      state.landingProgress = 100;
      state.line.tension = Math.min(state.line.tension, 72);
    }
  }
  state.line.tension = Math.round(state.line.tension * 100) / 100;
};
