import type { z } from "zod";
import type { UserData } from "@/drizzle/schema";
import { getPublicQuestUser } from "@/libs/quest";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { healerAfterHealSchema } from "@/validators/hospital";

/** Combine the exact healed pools with the committed, publicly masked medical quest progress. */
export const getHealerUserPatch = (
  user: NonNullable<UserWithRelations>,
  healer: z.infer<typeof healerAfterHealSchema>,
  questData: UserData["questData"],
) => ({ ...healer, questData: getPublicQuestUser({ ...user, questData }).questData });
