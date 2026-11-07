import type { BossArrival, EncounterWave } from "@/validators/coop";

/** The AI that fights as this form, and how it rises when it follows another form. */
export type BossForm = { readonly aiId: string; readonly arrival?: BossArrival };

/**
 * `initiateBattle` input for a multi-form boss, weakest form first. Each form falls into the
 * next on the same tile, in one battle. Every form is a seeded AI; a form with an arrival
 * should also bind a `TRANSFORMATION_ACTION` sprite animation, and plays without a clip if not.
 */
export const bossFightEncounter = (forms: readonly BossForm[]) => ({
  targetIds: forms.map((form) => form.aiId),
  encounterWaves: forms.map(
    ({ aiId, arrival }): EncounterWave => ({
      aiIds: [aiId],
      delayRounds: 0,
      ...(arrival ? { arrival } : {}),
    }),
  ),
});
