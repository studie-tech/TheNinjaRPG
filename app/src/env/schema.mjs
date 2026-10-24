// @ts-check
import { z } from "zod";

/**
 * Specify your server-side environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
export const serverSchema = z.object({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_NORMAL: z.string().optional(),
  STRIPE_PRICE_SILVER: z.string().optional(),
  STRIPE_PRICE_GOLD: z.string().optional(),
  SHOPIFY_STORE_DOMAIN: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).or(z.literal("")).optional(),
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: z.string().min(1).or(z.literal("")).optional(),
  MERCH_CHECKOUT_ENABLED: z.enum(["true", "false"]).optional(),
  OPENAI_API_KEY: z.string().optional(),
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_APP_SECRET: z.string().optional(),
  DATABASE_URL: z.url().optional(),
  DEV_DATABASE_URL: z.url().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]),
  /**
   * Pull zone in front of production; unset serves everything from the app itself. Its
   * value becomes a script-src host and the scheme the zone pulls over, so only a bare
   * https origin is accepted.
   */
  CDN_URL: z
    .url({ protocol: /^https$/ })
    .refine(
      (value) => URL.canParse(value) && value.replace(/\/+$/, "") === new URL(value).origin,
      { message: "CDN_URL must be a bare origin, without a path" },
    )
    .or(z.literal(""))
    .optional(),
  DISCORD_CONTENT_UPDATES: z.url().optional(),
  DISCORD_NEWS_UPDATES: z.url().optional(),
  DISCORD_TICKETS: z.url().optional(),
  /**
   * Discord account linking with Linked Roles (docs/DiscordLinking.md). Stays off unless
   * DISCORD_LINKING_ENABLED is "true" and the application, bot, guild and encryption key
   * below are all configured.
   */
  DISCORD_LINKING_ENABLED: z.enum(["true", "false"]).optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  // Role the bot grants to every linked member; leave unset when Linked Roles grants it.
  DISCORD_VERIFIED_ROLE_ID: z.string().optional(),
  // JSON object of TNR village id to Discord role id, e.g. {"<villageId>":"<roleId>"}
  DISCORD_VILLAGE_ROLE_IDS: z.string().optional(),
  // Key for the stored OAuth tokens: 32 bytes as base64 or 64 hex characters
  DISCORD_TOKEN_ENCRYPTION_KEY: z.string().optional(),
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
  // Epidemic Sound Partner API key for sound suggestions in the content review desk
  EPIDEMIC_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  CAPTCHA_SALT: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  NATIVE_CLERK_PROXY_ENABLED: z.enum(["true", "false"]).optional(),
  /**
   * Vercel BotID on tRPC mutations (src/server/utils/botid.ts). Unset blocks detected bots
   * on the production deployment only; "false" records detections without blocking;
   * "true" also blocks on preview deployments.
   */
  BOTID_ENFORCE: z.enum(["true", "false"]).optional(),
  AI_TEST_USER_BROKER_TOKEN: z.string().optional(),
  // Tower Defense HMAC secret for signing session data
  TOWER_DEFENSE_HMAC_SECRET: z.string().optional(),
  // Tower Defense reward claims are refused unless this is "true"
  TOWER_DEFENSE_CLAIMS_ENABLED: z.enum(["true", "false"]).optional(),
  // Key for the IP hashes in visitor analytics; changing it breaks every stored join
  IP_HASH_SECRET: z.string().optional(),
  // Apple Push Notification service. APNS_PRIVATE_KEY holds the contents of the .p8
  // key file; newlines may be escaped as \n because most secret stores are single-line.
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_USE_SANDBOX: z.enum(["true", "false"]).optional(),
  // Firebase Cloud Messaging HTTP v1, authenticated with a service account.
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.email().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),
  // Deep link association files served from /.well-known.
  ANDROID_PACKAGE_NAME: z.string().optional(),
  ANDROID_CERT_FINGERPRINTS: z.string().optional(),
  // Shared secret sent by RevenueCat in the Authorization header of every webhook.
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  // RevenueCat dashboard app ids. TRANSFER can omit store but still includes app_id.
  REVENUECAT_IOS_APP_ID: z.string().optional(),
  REVENUECAT_ANDROID_APP_ID: z.string().optional(),
  /**
   * Accounts whose sandbox purchases still grant, comma separated.
   *
   * TestFlight and App Review always transact in the sandbox, so the reviewer's demo
   * account belongs here for a submission; leaving it unset means no sandbox receipt ever
   * moves a balance.
   */
  STORE_SANDBOX_USER_IDS: z.string().optional(),
});

/**
 * You can't destruct `process.env` as a regular object in the Next.js
 * middleware, so you have to do it manually here.
 * @type {{ [k in keyof z.infer<typeof serverSchema>]: z.infer<typeof serverSchema>[k] | undefined }}
 */
export const serverEnv = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_NORMAL: process.env.STRIPE_PRICE_NORMAL,
  STRIPE_PRICE_SILVER: process.env.STRIPE_PRICE_SILVER,
  STRIPE_PRICE_GOLD: process.env.STRIPE_PRICE_GOLD,
  SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
  MERCH_CHECKOUT_ENABLED: /** @type {"true" | "false" | undefined} */ (process.env.MERCH_CHECKOUT_ENABLED),
  CDN_URL: process.env.CDN_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PUSHER_APP_ID: process.env.PUSHER_APP_ID,
  PUSHER_APP_SECRET: process.env.PUSHER_APP_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  DEV_DATABASE_URL: process.env.DEV_DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  DISCORD_CONTENT_UPDATES: process.env.DISCORD_CONTENT_UPDATES,
  DISCORD_NEWS_UPDATES: process.env.DISCORD_NEWS_UPDATES,
  DISCORD_TICKETS: process.env.DISCORD_TICKETS,
  DISCORD_LINKING_ENABLED: /** @type {"true" | "false" | undefined} */ (
    process.env.DISCORD_LINKING_ENABLED
  ),
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
  DISCORD_VERIFIED_ROLE_ID: process.env.DISCORD_VERIFIED_ROLE_ID,
  DISCORD_VILLAGE_ROLE_IDS: process.env.DISCORD_VILLAGE_ROLE_IDS,
  DISCORD_TOKEN_ENCRYPTION_KEY: process.env.DISCORD_TOKEN_ENCRYPTION_KEY,
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
  EPIDEMIC_API_KEY: process.env.EPIDEMIC_API_KEY,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  CAPTCHA_SALT: process.env.CAPTCHA_SALT,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  NATIVE_CLERK_PROXY_ENABLED: /** @type {"true" | "false" | undefined} */ (
    process.env.NATIVE_CLERK_PROXY_ENABLED
  ),
  BOTID_ENFORCE: /** @type {"true" | "false" | undefined} */ (process.env.BOTID_ENFORCE),
  AI_TEST_USER_BROKER_TOKEN: process.env.AI_TEST_USER_BROKER_TOKEN,
  IP_HASH_SECRET: process.env.IP_HASH_SECRET,
  // Tower Defense HMAC secret for signing session data
  TOWER_DEFENSE_HMAC_SECRET: process.env.TOWER_DEFENSE_HMAC_SECRET,
  TOWER_DEFENSE_CLAIMS_ENABLED: /** @type {"true" | "false" | undefined} */ (
    process.env.TOWER_DEFENSE_CLAIMS_ENABLED
  ),
  // Apple Push Notification service
  APNS_KEY_ID: process.env.APNS_KEY_ID,
  APNS_TEAM_ID: process.env.APNS_TEAM_ID,
  APNS_PRIVATE_KEY: process.env.APNS_PRIVATE_KEY,
  APNS_BUNDLE_ID: process.env.APNS_BUNDLE_ID,
  APNS_USE_SANDBOX: /** @type {"true" | "false" | undefined} */ (
    process.env.APNS_USE_SANDBOX
  ),
  // Firebase Cloud Messaging
  FCM_PROJECT_ID: process.env.FCM_PROJECT_ID,
  FCM_CLIENT_EMAIL: process.env.FCM_CLIENT_EMAIL,
  FCM_PRIVATE_KEY: process.env.FCM_PRIVATE_KEY,
  // Deep link association files
  ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME,
  ANDROID_CERT_FINGERPRINTS: process.env.ANDROID_CERT_FINGERPRINTS,
  // RevenueCat
  REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET,
  REVENUECAT_IOS_APP_ID: process.env.REVENUECAT_IOS_APP_ID,
  REVENUECAT_ANDROID_APP_ID: process.env.REVENUECAT_ANDROID_APP_ID,
  STORE_SANDBOX_USER_IDS: process.env.STORE_SANDBOX_USER_IDS,
};

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
  // Optional public presentation rollout; game layout preferences remain per device.
  NEXT_PUBLIC_WELCOME_LAYOUT: z.string().optional(),
  NEXT_PUBLIC_NODE_ENV: z.enum(["development", "test", "production"]),
  // SpacetimeDB for Tower Defense
  NEXT_PUBLIC_SPACETIMEDB_HOST: z.string().optional(),
  NEXT_PUBLIC_SPACETIMEDB_MODULE: z.string().optional(),
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
  NEXT_PUBLIC_WELCOME_LAYOUT: process.env.NEXT_PUBLIC_WELCOME_LAYOUT,
  NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
  // SpacetimeDB for Tower Defense
  NEXT_PUBLIC_SPACETIMEDB_HOST: process.env.NEXT_PUBLIC_SPACETIMEDB_HOST,
  NEXT_PUBLIC_SPACETIMEDB_MODULE: process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE,
  // RevenueCat
  NEXT_PUBLIC_REVENUECAT_IOS_KEY: process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY,
  NEXT_PUBLIC_REVENUECAT_ANDROID_KEY: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY,
};
