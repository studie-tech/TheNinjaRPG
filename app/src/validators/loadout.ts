import { z } from "zod";
import { LOADOUT_NAME_MAX_LENGTH } from "@/drizzle/constants";

export const renameLoadoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(LOADOUT_NAME_MAX_LENGTH),
});
export type RenameLoadoutSchema = z.infer<typeof renameLoadoutSchema>;
