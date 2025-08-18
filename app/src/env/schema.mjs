// @ts-check
import { z } from "zod";

/**
 * Specify your server-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
export const serverSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_APP_SECRET: z.string().optional(),
  DATABASE_URL: z.string().url().optional(),
  DEV_DATABASE_URL: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]),
  DISCORD_CONTENT_UPDATES: z.string().url().optional(),
  DISCORD_NEWS_UPDATES: z.string().url().optional(),
  DISCORD_TICKETS: z.string().url().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  CAPTCHA_SALT: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
});

/**
 * You can't destruct `process.env` as a regular object in the Next.js
 * middleware, so you have to do it manually here.
 * @type {{ [k in keyof z.infer<typeof serverSchema>]: z.infer<typeof serverSchema>[k] | undefined }}
 */
export const serverEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PUSHER_APP_ID: process.env.PUSHER_APP_ID,
  PUSHER_APP_SECRET: process.env.PUSHER_APP_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  DEV_DATABASE_URL: process.env.DEV_DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  DISCORD_CONTENT_UPDATES: process.env.DISCORD_CONTENT_UPDATES,
  DISCORD_NEWS_UPDATES: process.env.DISCORD_NEWS_UPDATES,
  DISCORD_TICKETS: process.env.DISCORD_TICKETS,
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  CAPTCHA_SALT: process.env.CAPTCHA_SALT,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
};

/**
 * Specify your client-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 * To expose them to the client, prefix them with `NEXT_PUBLIC_`.
 */
export const clientSchema = z.object({
  NEXT_PUBLIC_PUSHER_APP_KEY: z.string(),
  NEXT_PUBLIC_PUSHER_APP_CLUSTER: z.string(),
  NEXT_PUBLIC_BASE_URL: z.string().url(),
  NEXT_PUBLIC_MEASUREMENT_ID: z.string().optional(),
  NEXT_PUBLIC_NODE_ENV: z.enum(["development", "test", "production"]),
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
  NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
};
