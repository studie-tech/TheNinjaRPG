import { z } from "zod";

/** Reputation and ryo offered in a black market trade. */
export const blackMarketOfferSchema = z.object({
  reps: z.coerce.number().int().min(1),
  ryo: z.coerce.number().int().min(1),
});
export type BlackMarketOfferSchemaInput = z.input<typeof blackMarketOfferSchema>;
export type BlackMarketOfferSchema = z.infer<typeof blackMarketOfferSchema>;
