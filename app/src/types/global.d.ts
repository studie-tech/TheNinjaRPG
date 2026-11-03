declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      DISCORD_CONTENT_UPDATES: string;
      DISCORD_NEWS_UPDATES: string;
      FACEBOOK_PAGE_ID: string;
      FACEBOOK_PAGE_ACCESS_TOKEN: string;
      INSTAGRAM_BUSINESS_ACCOUNT_ID: string;
      REDDIT_CLIENT_ID: string;
      REDDIT_CLIENT_SECRET: string;
      REDDIT_REFRESH_TOKEN: string;
      REDDIT_SUBREDDIT: string;
      TWITTER_API_KEY: string;
      TWITTER_API_SECRET: string;
      TWITTER_ACCESS_TOKEN: string;
      TWITTER_ACCESS_SECRET: string;
      REPLICATE_API_TOKEN: string;
      CAPTCHA_SALT: string;
      PUSHER_APP_ID: string;
      PUSHER_APP_SECRET: string;
      NEXT_PUBLIC_PUSHER_APP_KEY: string;
      NEXT_PUBLIC_PUSHER_APP_CLUSTER: string;
      PAYPAL_CLIENT_SECRET: string;
      NEXT_PUBLIC_PAYPAL_URL: string;
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: string;
      NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL: string;
      NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER: string;
      NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD: string;
      NEXT_PUBLIC_BASE_URL: string;
    }
  }
}

declare module "@g-loot/react-tournament-brackets";

// We must export something for it to be a module
export {};
