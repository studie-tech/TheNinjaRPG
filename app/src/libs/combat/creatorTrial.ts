import { CREATOR_TRIAL_FORMS, CREATOR_USERNAME } from "@/drizzle/constants";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import type { EncounterWave } from "@/validators/coop";

/** Frozen at initiation, so settlement credits the creator without reading their account. */
export type CreatorTrialState = { creatorId: string; username: string };

/** The creator's own account, which open-world attacks never reach. */
export const isCreator = (user: { username: string; isAi?: boolean | number }) =>
  !user.isAi && user.username === CREATOR_USERNAME;

/** One combatant per form: each spawns only once the form before it falls. */
export const creatorTrialWaves = (): EncounterWave[] =>
  CREATOR_TRIAL_FORMS.map(({ aiId }) => ({ aiIds: [aiId], delayRounds: 0 }));

/** The form at a 1-based encounter stage. */
export const creatorTrialForm = (stage: number) => CREATOR_TRIAL_FORMS[stage - 1];

/** Log line for a form that has just risen from the one before it. */
export const creatorTrialTransformationLog = (
  battle: CompleteBattle,
  form: BattleUserState,
) => {
  const stage = form.transformation?.stage ?? 0;
  const username = battle.extraState.creatorTrial?.username ?? CREATOR_USERNAME;
  const title = creatorTrialForm(stage)?.title;
  return `${username} refuses to fall and reassembles as ${title ?? form.username}!`;
};
