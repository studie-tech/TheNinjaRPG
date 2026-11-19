import { z } from "zod";
import { isBunnyCdnUrl, transformImageUrl } from "@/utils/image";

/** Only local game destinations are offered by the welcome board. */
const destination = z
  .string()
  .max(300)
  .regex(/^\/[A-Za-z0-9][A-Za-z0-9/_?=&%#.-]*$/);
const image = z.union([
  z.literal(""),
  z
    .url()
    .max(1000)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          isBunnyCdnUrl(transformImageUrl(value))
        );
      } catch {
        return false;
      }
    }, "Use an uploaded game image from the game CDN"),
]);

/** Staff-editable announcement board shared by the editor and content review desk. */
export const splashSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(300),
    image,
    enabled: z.boolean(),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    cards: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(80),
          body: z.string().trim().min(1).max(600),
          image,
          href: destination,
          linkLabel: z.string().trim().min(1).max(60),
        }),
      )
      .min(1)
      .max(6),
  })
  .refine(
    (data) =>
      !data.startsAt ||
      !data.endsAt ||
      Date.parse(data.startsAt) < Date.parse(data.endsAt),
    {
      message: "The end must be after the start",
      path: ["endsAt"],
    },
  );
export type SplashContent = z.infer<typeof splashSchema>;
