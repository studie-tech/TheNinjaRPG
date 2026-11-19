import { z } from "zod";
import { CONSENT_REVISION } from "@/libs/consentConfig";

export const metaConsentSchema = z.object({
  revision: z.number().int().nonnegative(),
  consentId: z.uuid(),
  decidedAt: z.iso.datetime(),
  granted: z.boolean(),
});

// Meta identifiers are transmitted verbatim, never hashed or synthesized without a click.
export const metaTrackingSchema = metaConsentSchema.extend({
  revision: z.literal(CONSENT_REVISION),
  granted: z.literal(true),
  fbc: z
    .string()
    .max(512)
    .regex(/^fb\.[0-9]+\.[0-9]{13}\.[A-Za-z0-9_-]+$/)
    .optional(),
  fbp: z
    .string()
    .max(128)
    .regex(/^fb\.[0-9]+\.[0-9]{13}\.[0-9]+$/)
    .optional(),
});
export type MetaTrackingInput = z.infer<typeof metaTrackingSchema>;
