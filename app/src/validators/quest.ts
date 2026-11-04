import { z } from "zod";
import { LetterRanks, QuestTypes } from "@/drizzle/constants";
import { allObjectiveTasks } from "@/validators/objectives";

/** Highest level accepted by the quest search and filter inputs. */
export const QUEST_FILTER_MAX_LEVEL = 150;

export const questFilteringSchema = z.object({
  name: z.string().min(0).max(256).optional(),
  objectives: z.array(z.enum(allObjectiveTasks)).optional(),
  questType: z.enum(QuestTypes).optional(),
  rank: z.enum(LetterRanks).optional(),
  userLevel: z.coerce.number().min(0).max(QUEST_FILTER_MAX_LEVEL).optional(),
  village: z.string().optional(),
  bloodline: z.string().optional(),
  /** Filter quests that require this equipped sage mode id. */
  sageMode: z.string().optional(),
  hidden: z.boolean().optional(),
});
