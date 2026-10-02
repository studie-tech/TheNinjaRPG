import { z } from "zod";
import { ElementNames } from "@/drizzle/constants";

/** Classification is independent of the elements targeted by combat effects. */
export const elementClassificationSchema = z
  .array(z.enum(ElementNames))
  .refine((elements) => !elements.includes("None") || elements.length === 1, {
    message: "None cannot be combined with elemental classifications",
  })
  .transform((elements) => [
    ...new Set(elements.filter((element) => element !== "None")),
  ]);

export const elementClassificationMappingSchema = z.object({
  jutsus: z.array(
    z.object({ id: z.string().min(1), elements: elementClassificationSchema }),
  ),
  items: z.array(
    z.object({ id: z.string().min(1), elements: elementClassificationSchema }),
  ),
});

export const elementClassificationCatalogSchema = z.object({
  jutsus: z.array(z.object({ id: z.string().min(1) })),
  items: z.array(z.object({ id: z.string().min(1) })),
});
