import { BOSS_FIGHT_MAX_FORMS } from "@/drizzle/constants";
import type { AiTransformation } from "@/drizzle/schema";
import type { BossArrival, EncounterWave } from "@/validators/coop";

/** The AI that fights as this form, and how it rises when it follows another form. */
export type BossForm = { readonly aiId: string; readonly arrival?: BossArrival };

/** Who a fight is against, and the waves they arrive in when there is more than one. */
export type BossFight = { targetIds: string[]; waves?: EncounterWave[] };

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

/** Follow each lone wave enemy with its later forms; packs have no single form to replace. */
export const expandBossWaves = (
  waves: EncounterWave[],
  transformations: AiTransformation[],
): EncounterWave[] =>
  waves.flatMap((wave) => {
    const [aiId, ...others] = wave.aiIds;
    if (!aiId || others.length > 0) return [wave];
    const later = bossFormsFrom(aiId, transformations)
      .slice(1)
      .map(
        ({ aiId, arrival }): EncounterWave => ({
          aiIds: [aiId],
          delayRounds: 0,
          ...(arrival ? { arrival } : {}),
        }),
      );
    return [wave, ...later];
  });

/**
 * A fight's opponents once each lone enemy brings its later forms. A single target that
 * transforms becomes a boss fight: each form falls into the next on the same tile, in one
 * battle. Returns `fight` itself when nobody transforms.
 */
export const withBossForms = (
  fight: BossFight,
  transformations: AiTransformation[],
): BossFight => {
  const authored =
    fight.waves ??
    (fight.targetIds.length === 1 ? [{ aiIds: fight.targetIds, delayRounds: 0 }] : []);
  const waves = expandBossWaves(authored, transformations);
  if (waves.length === authored.length) return fight;
  return { targetIds: waves.flatMap((wave) => wave.aiIds), waves };
};

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
