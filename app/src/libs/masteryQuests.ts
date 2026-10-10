import {
  MASTERY_RANK_REQUIREMENTS,
  MASTERY_RANKS,
  MasteryNames,
  MasteryTypes,
} from "@/drizzle/constants";
import { MASTERY_REQUIREMENT_FIELDS } from "@/libs/mastery";
import { QuestValidator } from "@/validators/objectives";

/**
 * One hidden, editable exam per discipline and promotable rank, with stable content IDs.
 * Default earned thresholds come from MASTERY_RANK_REQUIREMENTS; staff may customize
 * them alongside objectives and scenes before publishing. Eligibility uses the stored
 * previous rank rather than prerequisite quest history, so backfilled users can advance.
 * QuestValidator supplies the same objective and reward defaults as the content editor.
 */
export const masteryQuestTemplates = () =>
  MasteryNames.flatMap((stat, index) =>
    MASTERY_RANKS.filter((rank) => rank !== "NONE").map((rank) => {
      const mastery = MasteryTypes[index];
      const requirement = MASTERY_REQUIREMENT_FIELDS[index];
      if (!mastery || !requirement) throw new Error("Mastery definitions must align");
      const id = `mastery-${stat}-${rank.toLowerCase()}`;
      return {
        id,
        ...QuestValidator.parse({
          name: `${mastery} Mastery: ${rank.charAt(0) + rank.slice(1).toLowerCase()}`,
          description: `Demonstrate your ${mastery} mastery to earn the ${rank.toLowerCase()} rank.`,
          successDescription: `You earned the ${rank.toLowerCase()} rank in ${mastery} mastery.`,
          questType: "mastery",
          questRank: "D",
          requiredLevel: 1,
          maxLevel: 100,
          maxAttempts: 100,
          maxCompletes: 1,
          hidden: true,
          consecutiveObjectives: false,
          endsAt: null,
          startsAt: null,
          tierLevel: null,
          [requirement[0]]: MASTERY_RANK_REQUIREMENTS[rank],
          prerequisiteQuestId: null,
          retryDelay: "none" as const,
          requiredVillage: null,
          requiredBloodlineId: null,
          medicalRank: null,
          huntingRank: null,
          gatheringRank: null,
          content: {
            objectives: [
              {
                id: `${id}-train`,
                task: "train_specific_jutsu",
                masteryType: mastery,
                value: 1,
                description: `Train a new ${mastery} jutsu.`,
              },
              {
                id: `${id}-use`,
                task: "use_specific_jutsu_combat",
                masteryType: mastery,
                combatType: "PVP",
                value: 5,
                description: `Use ${mastery} jutsu five times in PvP combat.`,
              },
              {
                id: `${id}-pve`,
                task: "arena_kills",
                value: 1,
                description: "Win an arena battle.",
              },
            ],
            reward: { reward_mastery_stat: stat, reward_mastery_rank: rank },
          },
        }),
        retryDelay: "none" as const,
        requiredVillage: null,
        requiredBloodlineId: null,
        prerequisiteQuestId: null,
        medicalRank: null,
        huntingRank: null,
        gatheringRank: null,
      };
    }),
  );
