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

/** One announcement, shared by staff editing and reviewed proposals. */
export const splashSchema = z
  .object({
    topicKey: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens"),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(600),
    image,
    href: destination,
    linkLabel: z.string().trim().min(1).max(60),
    priority: z.number().int().min(-1000).max(1000),
    enabled: z.boolean(),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
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
export type SplashFormInput = z.input<typeof splashSchema>;
export type SplashInput = z.infer<typeof splashSchema>;
