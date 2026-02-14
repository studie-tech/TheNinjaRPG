import { z } from "zod";
import { TournamentTypes } from "@/drizzle/constants";
import { ObjectiveReward } from "@/validators/rewards";

export const tournamentCreateSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(3).max(88),
  image: z.string(),
  description: z.string().trim().min(3).max(500),
  type: z.enum(TournamentTypes),
  rewards: ObjectiveReward,
});

export type TournamentCreateSchema = z.infer<typeof tournamentCreateSchema>;
export type TournamentCreateSchemaInput = z.input<typeof tournamentCreateSchema>;
