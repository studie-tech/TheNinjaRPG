import { z } from "zod";
import { SAGE_MODE_MAX_LEVEL } from "@/drizzle/constants";

/**
 * Query input for `sageMode.getAll` / `sageModeDatabaseFilter`.
 * `hidden` is a tri-state: `undefined` = all (staff only), `true`/`false` = that set.
 */
export const sageModeFilteringSchema = z.object({
  name: z.string().min(0).max(256).optional(),
  village: z.string().optional(),
  level: z.coerce.number().min(1).max(SAGE_MODE_MAX_LEVEL).optional(),
  hidden: z.boolean().optional(),
});

export type SageModeFilteringSchema = z.infer<typeof sageModeFilteringSchema>;
