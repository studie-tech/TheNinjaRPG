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
  FACEBOOK_PAGE_ID: z.string().optional(),
  FACEBOOK_PAGE_ACCESS_TOKEN: z.string().optional(),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_REFRESH_TOKEN: z.string().optional(),
  REDDIT_SUBREDDIT: z.string().optional(),
  TWITTER_API_KEY: z.string().optional(),
  TWITTER_API_SECRET: z.string().optional(),
  TWITTER_ACCESS_TOKEN: z.string().optional(),
  TWITTER_ACCESS_SECRET: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  CAPTCHA_SALT: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  // Tower Defense HMAC secret for signing session data
  TOWER_DEFENSE_HMAC_SECRET: z.string().optional(),
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
  FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_ACCESS_TOKEN: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
  INSTAGRAM_BUSINESS_ACCOUNT_ID: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
  REDDIT_REFRESH_TOKEN: process.env.REDDIT_REFRESH_TOKEN,
  REDDIT_SUBREDDIT: process.env.REDDIT_SUBREDDIT,
  TWITTER_API_KEY: process.env.TWITTER_API_KEY,
  TWITTER_API_SECRET: process.env.TWITTER_API_SECRET,
  TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET,
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  CAPTCHA_SALT: process.env.CAPTCHA_SALT,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  // Tower Defense HMAC secret for signing session data
  TOWER_DEFENSE_HMAC_SECRET: process.env.TOWER_DEFENSE_HMAC_SECRET,
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
  // SpacetimeDB for Tower Defense
  NEXT_PUBLIC_SPACETIMEDB_HOST: z.string().optional(),
  NEXT_PUBLIC_SPACETIMEDB_MODULE: z.string().optional(),
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
  // SpacetimeDB for Tower Defense
  NEXT_PUBLIC_SPACETIMEDB_HOST: process.env.NEXT_PUBLIC_SPACETIMEDB_HOST,
  NEXT_PUBLIC_SPACETIMEDB_MODULE: process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE,
};
