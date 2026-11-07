import { BOSS_FIGHT_MAX_FORMS } from "@/drizzle/constants";
import type { AiTransformation } from "@/drizzle/schema";
import type { BossArrival, EncounterWave } from "@/validators/coop";

/** The AI that fights as this form, and how it rises when it follows another form. */
export type BossForm = { readonly aiId: string; readonly arrival?: BossArrival };

/** A chain's forms in order from `aiId`, which is a boss fight once there is more than one. */
export const bossFormsFrom = (
  aiId: string,
  transformations: AiTransformation[],
): BossForm[] => {
  const links = new Map(transformations.map((link) => [link.userId, link]));
  const forms: BossForm[] = [{ aiId }];
  const seen = new Set([aiId]);
  let link = links.get(aiId);
  while (link && !seen.has(link.nextAiId) && forms.length < BOSS_FIGHT_MAX_FORMS) {
    const { nextAiId, announce, log, tier, color, glow } = link;
    forms.push({ aiId: nextAiId, arrival: { announce, log, tier, color, glow } });
    seen.add(nextAiId);
    link = links.get(nextAiId);
  }
  return forms;
};

/**
 * `initiateBattle` input for a multi-form boss, weakest form first. Each form falls into the
 * next on the same tile, in one battle.
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

/** Follow each lone wave enemy with its later forms; packs have no single form to replace. */
export const expandBossWaves = (
  waves: EncounterWave[],
  transformations: AiTransformation[],
): EncounterWave[] =>
  waves.flatMap((wave) => {
    const [aiId, ...others] = wave.aiIds;
    if (!aiId || others.length > 0) return [wave];
    const [, ...later] = bossFightEncounter(
      bossFormsFrom(aiId, transformations),
    ).encounterWaves;
    return [wave, ...later];
  });

/** Why saving this link would break a chain, walking every chain it could join. */
export const bossChainIssue = (
  link: Pick<AiTransformation, "userId" | "nextAiId">,
  transformations: Pick<AiTransformation, "userId" | "nextAiId">[],
) => {
  if (link.nextAiId === link.userId) return "An AI cannot transform into itself";
  const next = new Map(transformations.map((row) => [row.userId, row.nextAiId]));
  next.set(link.userId, link.nextAiId);
  for (const start of next.keys()) {
    const seen = new Set([start]);
    let at = next.get(start);
    while (at) {
      if (seen.has(at)) return "These forms would transform in a loop";
      seen.add(at);
      at = next.get(at);
    }
    if (seen.size > BOSS_FIGHT_MAX_FORMS)
      return `A boss fight can have at most ${BOSS_FIGHT_MAX_FORMS} forms`;
  }
  return undefined;
};
