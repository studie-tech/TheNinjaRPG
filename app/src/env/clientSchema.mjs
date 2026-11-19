// @ts-check
import { z } from "zod";

/**
 * Specify your client-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 * To expose them to the client, prefix them with `NEXT_PUBLIC_`.
 */
export const clientSchema = z.object({
  NEXT_PUBLIC_PUSHER_APP_KEY: z.string(),
  NEXT_PUBLIC_PUSHER_APP_CLUSTER: z.string(),
  NEXT_PUBLIC_BASE_URL: z.url(),
  NEXT_PUBLIC_MEASUREMENT_ID: z.string().optional(),
  NEXT_PUBLIC_META_PIXEL_ID: z.string().regex(/^\d+$/).optional(),
  // Optional public presentation rollout; game layout preferences remain per device.
  NEXT_PUBLIC_WELCOME_LAYOUT: z.string().optional(),
  NEXT_PUBLIC_NODE_ENV: z.enum(["development", "test", "production"]),
  // RevenueCat public SDK keys. Public by design -- they only identify the app.
  NEXT_PUBLIC_REVENUECAT_IOS_KEY: z.string().optional(),
  NEXT_PUBLIC_REVENUECAT_ANDROID_KEY: z.string().optional(),
});

/**
 * You can't destruct `process.env` as a regular object, so you have to do
 * it manually here. This is because Next.js evaluates this at build time,
 * and only used environment variables are included in the build.
 * @type {{ [k in keyof z.infer<typeof clientSchema>]: z.infer<typeof clientSchema>[k] | undefined }}
 */
export const clientEnv = {
  NEXT_PUBLIC_PUSHER_APP_KEY: process.env.NEXT_PUBLIC_PUSHER_APP_KEY,
  NEXT_PUBLIC_PUSHER_APP_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_APP_CLUSTER,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_MEASUREMENT_ID: process.env.NEXT_PUBLIC_MEASUREMENT_ID,
  NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  NEXT_PUBLIC_WELCOME_LAYOUT: process.env.NEXT_PUBLIC_WELCOME_LAYOUT,
  NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
  // RevenueCat
  NEXT_PUBLIC_REVENUECAT_IOS_KEY: process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY,
  NEXT_PUBLIC_REVENUECAT_ANDROID_KEY: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY,
};
