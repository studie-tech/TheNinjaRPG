import { z } from "zod";
import { WAR_ALLY_OFFER_MIN } from "@/drizzle/constants";

export const createAllianceOfferSchema = (maxTokens: number) =>
  z.object({
    amount: z.coerce.number().int().positive().min(WAR_ALLY_OFFER_MIN).max(maxTokens),
  });

export type AllianceOfferSchemaInput = z.input<
  ReturnType<typeof createAllianceOfferSchema>
>;
export type AllianceOfferSchema = z.infer<ReturnType<typeof createAllianceOfferSchema>>;
