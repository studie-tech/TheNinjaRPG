import crypto from "node:crypto";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type { UserData } from "@/drizzle/schema";
import type { TicketType } from "@/validators/misc";

export const callDiscordContent = async (
  username: string,
  updated_name: string,
  diff: string[],
  image_url?: string | null,
) => {
  return fetch(process.env.DISCORD_CONTENT_UPDATES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      avatar_url: image_url?.includes("https") ? image_url : "",
      content: `**${username} updated ${updated_name}**\n* ${diff.join("\n* ")}`,
    }),
  });
};

export const callDiscordNews = async (
  _username: string,
  title: string,
  content: string,
  image_url?: string | null,
) => {
  const nhm = new NodeHtmlMarkdown({}, undefined, undefined);
  return fetch(process.env.DISCORD_NEWS_UPDATES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      avatar_url: image_url?.includes("https") ? image_url : "",
      content: nhm.translate(`**${title}**\n* ${content} @everyone`),
    }),
  });
};

export const callFacebookNews = async (title: string, content: string) => {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  // Skip if not configured
  if (!pageId || !accessToken) {
    console.warn("Facebook credentials not configured, skipping Facebook post");
    return;
  }

  const nhm = new NodeHtmlMarkdown({}, undefined, undefined);
  const message = nhm.translate(`${title}\n\n${content}`);

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
  const instagramAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  // Skip if not configured
  if (!instagramAccountId || !accessToken) {
    console.warn("Instagram credentials not configured, skipping Instagram post");
    return;
  }

  const nhm = new NodeHtmlMarkdown({}, undefined, undefined);
  const caption = nhm.translate(
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
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN;
  const subreddit = process.env.REDDIT_SUBREDDIT;

  // Skip if not configured
  if (!clientId || !clientSecret || !refreshToken || !subreddit) {
    console.warn("Reddit credentials not configured, skipping Reddit post");
    return;
  }

  const nhm = new NodeHtmlMarkdown({}, undefined, undefined);
  const text = nhm.translate(content);

  // Step 1: Get access token using refresh token
  const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    console.error("Failed to get Reddit access token:", tokenData);
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
      text: text,
    }),
  });
};

/**
 * Generate OAuth 1.0a signature for Twitter API.
 */
const generateOAuth1Signature = (
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
) => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? "")}`)
    .join("&");

  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join("&");

  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

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
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  // Skip if not configured
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.warn("Twitter credentials not configured, skipping Twitter post");
    return;
  }

  const nhm = new NodeHtmlMarkdown({}, undefined, undefined);
  const plainContent = nhm.translate(content);

  // Twitter has 280 char limit - compose tweet with title and truncated content
  const newsUrl = "https://www.theninja-rpg.com/news";
  const suffix = `\n\n🔗 ${newsUrl}`;
  const maxContentLength = 280 - title.length - suffix.length - 5; // 5 for "\n\n" and buffer
  const truncatedContent =
    plainContent.length > maxContentLength
      ? `${plainContent.substring(0, maxContentLength - 3)}...`
      : plainContent;
  const tweetText = `${title}\n\n${truncatedContent}${suffix}`;

  // OAuth 1.0a parameters
  const oauthParams: Record<string, string> = {
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
    oauthParams,
    apiSecret,
    accessSecret,
  );
  oauthParams.oauth_signature = signature;

  // Build Authorization header
  const authHeader =
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key] ?? "")}"`,
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

export const callDiscordTicket = async (
  thread_name: string,
  reason: string,
  type: TicketType,
  user: UserData,
) => {
  const nhm = new NodeHtmlMarkdown({}, undefined, undefined);
  const image_url = user.avatar;
  const content = `*Report from TNR interface*\n\n**Username:** ${user.username}\n**Reason:** ${nhm.translate(reason)}\n${type === "bug_report" ? "<@&1131406837762244760>" : "<@&1086822053254017105>"}\n`;
  return fetch(process.env.DISCORD_TICKETS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      avatar_url: image_url?.includes("https") ? image_url : "",
      content: content,
      username: user.username,
      thread_name,
      embeds: [
        {
          title: "User Information",
          description: `
            **Username:** ${user.username}
            **User ID:** ${user.userId}
            **Role:** ${user.role}
            **Banned**: ${user.isBanned ? "true" : "false"}
            **Silenced**: ${user.isSilenced ? "true" : "false"}
            **Federal Status:** ${user.federalStatus}

            **Level:** ${user.level}
            **Rank:** ${user.rank}
            **Status:** ${user.status}

            **Last update:** ${user.regenAt.toISOString()}`,
          color: 15844367,
        },
      ],
    }),
  });
};
