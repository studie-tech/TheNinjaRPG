import {
  CS_STAGE_INFO,
  CS_STAGES,
  CS_TRAINING,
  CS_TRAINING_INFO,
  type CsStage,
  type CsTraining,
  type CsTrainingLevels,
  csIntelFor,
  csNoTraining,
  csRunSeconds,
  csTrainingCost,
} from "@/libs/chakraStorm/content";

/**
 * Chakra Storm progress kept on the player's device: intel banked from finished runs,
 * the Training Hall levels bought with them, and each stage's best run.
 */
export interface CsProgress {
  intel: number;
  training: CsTrainingLevels;
  stages: Partial<Record<CsStage, CsStageRecord>>;
}

export interface CsStageRecord {
  /** Longest run held, in seconds. */
  seconds: number;
  kills: number;
  level: number;
  won: boolean;
}

/** A finished run: what it reached and where. */
export interface CsRunResult extends CsStageRecord {
  stage: CsStage;
  bosses: number;
}

export const CS_EMPTY_PROGRESS: CsProgress = {
  intel: 0,
  training: csNoTraining(),
  stages: {},
};

/** Read stored progress, keeping only valid numbers, known stages and known upgrades. */
export const parseCsProgress = (raw: string | null): CsProgress => {
  if (!raw) return CS_EMPTY_PROGRESS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return CS_EMPTY_PROGRESS;
    const { intel, training, stages } = value as Record<string, unknown>;
    const levels = csNoTraining();
    if (training && typeof training === "object")
      for (const id of CS_TRAINING)
        levels[id] = Math.min(
          CS_TRAINING_INFO[id].maxLevel,
          whole((training as Record<string, unknown>)[id]),
        );
    const records: CsProgress["stages"] = {};
    if (stages && typeof stages === "object")
      for (const id of CS_STAGES) {
        const entry = (stages as Record<string, unknown>)[id];
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        records[id] = {
          seconds: Math.min(csRunSeconds(id), whole(record.seconds)),
          kills: whole(record.kills),
          level: Math.max(1, whole(record.level)),
          won: record.won === true,
        };
      }
    return { intel: whole(intel), training: levels, stages: records };
  } catch {
    return CS_EMPTY_PROGRESS;
  }
};

/** Whether a stage is open: the first always is, each next one after a long enough run. */
export const csStageUnlocked = (progress: CsProgress, stage: CsStage) => {
  const index = CS_STAGES.indexOf(stage);
  if (index <= 0) return true;
  const previous = CS_STAGES[index - 1];
  const record = previous ? progress.stages[previous] : undefined;
  return !!record && record.seconds >= CS_STAGE_INFO[stage].unlockSeconds;
};

/** A region a run can open: the stage and how long the run must last to open it. */
export interface CsUnlockGoal {
  stage: CsStage;
  seconds: number;
}

/** The region a run in `stage` would open, or null when the next one is open or none is left. */
export const csNextUnlock = (
  progress: CsProgress,
  stage: CsStage,
): CsUnlockGoal | null => {
  const next = CS_STAGES[CS_STAGES.indexOf(stage) + 1];
  if (!next || csStageUnlocked(progress, next)) return null;
  return { stage: next, seconds: CS_STAGE_INFO[next].unlockSeconds };
};

/**
 * Bank a finished run: its intel joins the total and it may become the stage's best.
 * Also names the stage it opened, if any, for the results screen.
 */
export const settleCsRun = (progress: CsProgress, run: CsRunResult) => {
  const intel = csIntelFor(run);
  const previous = progress.stages[run.stage];
  const isBest = !previous || isBetter(run, previous);
  const next: CsProgress = {
    ...progress,
    intel: progress.intel + intel,
    stages: isBest
      ? {
          ...progress.stages,
          [run.stage]: {
            seconds: run.seconds,
            kills: run.kills,
            level: run.level,
            won: run.won,
          },
        }
      : progress.stages,
  };
  const unlocked = CS_STAGES.find(
    (stage) => !csStageUnlocked(progress, stage) && csStageUnlocked(next, stage),
  );
  return { progress: next, intel, isBest, unlocked };
};

/** Buy the next level of a Training Hall upgrade with banked intel. */
export const buyCsTraining = (
  progress: CsProgress,
  id: CsTraining,
): CsProgress | null => {
  const cost = csTrainingCost(id, progress.training);
  if (cost === null || cost > progress.intel) return null;
  return {
    ...progress,
    intel: progress.intel - cost,
    training: { ...progress.training, [id]: progress.training[id] + 1 },
  };
};

/** A win beats any loss; otherwise the longer run, then more kills. */
const isBetter = (record: CsStageRecord, previous: CsStageRecord) =>
  record.won !== previous.won
    ? record.won
    : record.seconds !== previous.seconds
      ? record.seconds > previous.seconds
      : record.kills > previous.kills;

const whole = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
