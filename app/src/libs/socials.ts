import crypto from "node:crypto";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { absoluteUrl } from "@/libs/seo";
import { truncateString } from "@/utils/string";

// Shared NodeHtmlMarkdown instance for converting HTML to Markdown across all social media integrations
const nodeHtmlMarkdown = new NodeHtmlMarkdown({}, undefined, undefined);

// Twitter character limits and formatting constants
const TWITTER_CHARACTER_LIMIT = 280;
const TWITTER_FORMATTING_BUFFER = 5; // For "\n\n" and buffer

/**
 * `bun test` forces NODE_ENV=test but still auto-loads app/.env, which holds the real Discord
 * webhooks and social credentials. Router suites that drive real content mutations would
 * otherwise post their fixtures to the production channels, so every outbound post is a no-op
 * under the test runner.
 */
export const isExternalPostingDisabled = () => process.env.NODE_ENV === "test";

/**
 * Validates that a webhook URL is a legitimate Discord webhook.
 * Prevents data exfiltration if environment variables are accidentally set to attacker-controlled URLs.
 */
export const isValidDiscordWebhook = (url: string | undefined): url is string => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    // Discord webhooks must be on discord.com or discordapp.com domains
    // and must follow the /api/webhooks/{id}/{token} pattern
    return (
      (parsed.hostname === "discord.com" || parsed.hostname === "discordapp.com") &&
      /^\/api\/webhooks\/\d+\/[\w-]+$/.test(parsed.pathname)
    );
  } catch {
    // Only the URL constructor can throw here, for strings that are not URLs
    return false;
  }
};

export const callDiscordContent = async (
  username: string,
  updated_name: string,
  diff: string[],
  image_url?: string | null,
) => {
  // Local content edits must not reach the content channel
  if (process.env.NODE_ENV === "development") return;
  return postDiscordWebhook(process.env.DISCORD_CONTENT_UPDATES, "content updates", {
    avatar_url: discordAvatar(image_url),
    content: `**${username} updated ${updated_name}**\n* ${diff.join("\n* ")}`,
  });
};

export const callDiscordNews = async (
  title: string,
  content: string,
  image_url?: string | null,
) => {
  return postDiscordWebhook(process.env.DISCORD_NEWS_UPDATES, "news updates", {
    avatar_url: discordAvatar(image_url),
    content: nodeHtmlMarkdown.translate(`**${title}**\n* ${content} @everyone`),
  });
};

export const callFacebookNews = async (title: string, content: string) => {
  if (isExternalPostingDisabled()) return;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  // Skip if not configured
  if (!pageId || !accessToken) {
    console.warn("Facebook credentials not configured, skipping Facebook post");
    return;
  }

  const message = nodeHtmlMarkdown.translate(`${title}\n\n${content}`);

  // SECURITY: Do not log request bodies for this endpoint as they contain the access token in plaintext
  return fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      access_token: accessToken,
    }),
  });
};

/**
 * Post to Instagram using the Content Publishing API.
 * Requires an image URL (Instagram doesn't support text-only posts).
 * Uses a two-step process: create container, then publish.
 */
export const callInstagramNews = async (
  title: string,
  content: string,
  imageUrl: string,
) => {
  if (isExternalPostingDisabled()) return;
  const instagramAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  // Skip if not configured
  if (!instagramAccountId || !accessToken) {
    console.warn("Instagram credentials not configured, skipping Instagram post");
    return;
  }

  const caption = nodeHtmlMarkdown.translate(
    `${title}\n\n${content}\n\n#TheNinjaRPG #BrowserGame #NinjaGame`,
  );

  // Step 1: Create the media container
  const containerResponse = await fetch(
    `https://graph.facebook.com/v21.0/${instagramAccountId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    },
  );

  const containerData = (await containerResponse.json()) as { id?: string };
  if (!containerData.id) {
    console.error("Failed to create Instagram media container:", containerData);
    return;
  }

  // Step 2: Publish the container
  return fetch(`https://graph.facebook.com/v21.0/${instagramAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: containerData.id,
      access_token: accessToken,
    }),
  });
};

/**
 * Post to Reddit using OAuth2 API.
 * Creates a text post (self post) in the configured subreddit.
 */
export const callRedditNews = async (title: string, content: string) => {
  if (isExternalPostingDisabled()) return;
  const oauthClientIdentifier = process.env.REDDIT_CLIENT_ID;
  const oauthClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const oauthRefreshToken = process.env.REDDIT_REFRESH_TOKEN;
  const subreddit = process.env.REDDIT_SUBREDDIT;

  // Skip if not configured
  if (
    !oauthClientIdentifier ||
    !oauthClientSecret ||
    !oauthRefreshToken ||
    !subreddit
  ) {
    console.warn("Reddit credentials not configured, skipping Reddit post");
    return;
  }

  const postContent = nodeHtmlMarkdown.translate(content);

  // Step 1: Get access token using refresh token
  // SECURITY: Do not log request headers for this endpoint as Authorization contains base64-encoded client secret
  const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${oauthClientIdentifier}:${oauthClientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oauthRefreshToken,
    }),
  });

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    // Log error without exposing the full response which may contain sensitive data
    console.error(
      "Failed to get Reddit access token:",
      tokenData.error ?? "Unknown error",
    );
    return;
  }

  // Step 2: Submit the post
  return fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "TheNinjaRPG/1.0",
    },
    body: new URLSearchParams({
      sr: subreddit,
      kind: "self",
      title: title,
      text: postContent,
    }),
  });
};

/**
 * Generate OAuth 1.0a signature for Twitter API.
 *
 * OAuth 1.0a signature algorithm (HMAC-SHA1):
 * 1. Sort all OAuth parameters alphabetically by key
 * 2. URL-encode each key and value, then join with "=" and "&" to create parameter string
 * 3. Create signature base string by joining (with "&"):
 *    - HTTP method (uppercase)
 *    - URL-encoded request URL
 *    - URL-encoded parameter string from step 2
 * 4. Create signing key by joining consumer secret and token secret with "&"
 * 5. Generate HMAC-SHA1 hash of signature base string using signing key
 * 6. Base64-encode the hash to get final signature
 *
 * NOTE: This implementation generates signatures for outgoing requests. If server-side signature
 * verification is added in the future, use constant-time comparison to prevent timing attacks.
 */
const generateOAuth1Signature = (
  httpMethod: string,
  requestUrl: string,
  oauthParameters: Record<string, string>,
  oauthConsumerSecret: string,
  oauthTokenSecret: string,
) => {
  // Step 1-2: Sort parameters and create encoded parameter string
  const sortedParams = Object.keys(oauthParameters)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(oauthParameters[key] ?? "")}`,
    )
    .join("&");

  // Step 3: Create signature base string (method&url&params)
  const signatureBaseString = [
    httpMethod.toUpperCase(),
    encodeURIComponent(requestUrl),
    encodeURIComponent(sortedParams),
  ].join("&");

  // Step 4: Create signing key (consumerSecret&tokenSecret)
  const signingKey = `${encodeURIComponent(oauthConsumerSecret)}&${encodeURIComponent(oauthTokenSecret)}`;

  // Step 5-6: Generate HMAC-SHA1 hash and base64-encode
  return crypto
    .createHmac("sha1", signingKey)
    .update(signatureBaseString)
    .digest("base64");
};

/**
 * Post to Twitter/X using OAuth 1.0a and API v2.
 * Creates a tweet with the news title and a truncated preview.
 */
export const callTwitterNews = async (title: string, content: string) => {
  if (isExternalPostingDisabled()) return;
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  // Skip if not configured
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.warn("Twitter credentials not configured, skipping Twitter post");
    return;
  }

  const plainContent = nodeHtmlMarkdown.translate(content);

  // Twitter has 280 char limit - compose tweet with title and truncated content
  const newsUrl = absoluteUrl("/news");
  const suffix = `\n\n🔗 ${newsUrl}`;
  const maxContentLength =
    TWITTER_CHARACTER_LIMIT - title.length - suffix.length - TWITTER_FORMATTING_BUFFER;
  const truncatedContent = truncateString(plainContent, maxContentLength);
  const tweetText = `${title}\n\n${truncatedContent}${suffix}`;

  // OAuth 1.0a parameters
  const oauthParameters: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Generate signature
  const url = "https://api.twitter.com/2/tweets";
  const signature = generateOAuth1Signature(
    "POST",
    url,
    oauthParameters,
    apiSecret,
    accessSecret,
  );
  oauthParameters.oauth_signature = signature;

  // Build Authorization header
  const authHeader =
    "OAuth " +
    Object.keys(oauthParameters)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}="${encodeURIComponent(oauthParameters[key] ?? "")}"`,
      )
      .join(", ");

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: tweetText }),
  });
};

/** POST to a configured Discord webhook, skipping test runs and refusing foreign URLs. */
const postDiscordWebhook = (
  webhookUrl: string | undefined,
  label: string,
  body: Record<string, unknown>,
) => {
  if (isExternalPostingDisabled()) return;
  if (!isValidDiscordWebhook(webhookUrl)) {
    console.error(`[Discord] Invalid webhook URL for ${label}`);
    return;
  }
  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

/** Discord only accepts https avatars; anything else posts without one. */
const discordAvatar = (imageUrl?: string | null) =>
  imageUrl?.includes("https") ? imageUrl : "";
