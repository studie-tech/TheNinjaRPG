import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  callDiscordContent,
  callDiscordNews,
  callFacebookNews,
  callInstagramNews,
  callRedditNews,
  callTwitterNews,
  isExternalPostingDisabled,
} from "@/libs/socials";
import { restoreEnvAfterEach } from "../setup/env";

// Placeholder credentials so every helper passes its own "configured?" check;
// only the test-runner guard can stop the post.
const FAKE_ENV: Record<string, string> = {
  DISCORD_CONTENT_UPDATES: "https://discord.com/api/webhooks/1/fake-token",
  DISCORD_NEWS_UPDATES: "https://discord.com/api/webhooks/2/fake-token",
  FACEBOOK_PAGE_ID: "page",
  FACEBOOK_PAGE_ACCESS_TOKEN: "token",
  INSTAGRAM_BUSINESS_ACCOUNT_ID: "account",
  REDDIT_CLIENT_ID: "id",
  REDDIT_CLIENT_SECRET: "secret",
  REDDIT_REFRESH_TOKEN: "refresh",
  REDDIT_SUBREDDIT: "sub",
  TWITTER_API_KEY: "key",
  TWITTER_API_SECRET: "secret",
  TWITTER_ACCESS_TOKEN: "token",
  TWITTER_ACCESS_SECRET: "secret",
};

const postEverywhere = () =>
  Promise.all([
    callDiscordContent("Staff", "Fixture", ["Updated: {}"]),
    callDiscordNews("Title", "Body"),
    callFacebookNews("Title", "Body"),
    callInstagramNews("Title", "Body", "https://example.com/a.png"),
    callRedditNews("Title", "Body"),
    callTwitterNews("Title", "Body"),
  ]);

describe("social posting under the test runner", () => {
  const env = process.env as Record<string, string | undefined>;
  restoreEnvAfterEach(...Object.keys(FAKE_ENV), "NODE_ENV");
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    Object.assign(env, FAKE_ENV);
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (async () =>
          new Response(JSON.stringify({ id: "x", access_token: "x" }))) as never,
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("runs with NODE_ENV=test, so posting is disabled", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(isExternalPostingDisabled()).toBe(true);
  });

  it("never reaches the network from any social helper", async () => {
    await postEverywhere();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps content updates off the channel in development", async () => {
    env.NODE_ENV = "development";
    await callDiscordContent("Staff", "Fixture", ["Updated: {}"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still posts outside the test runner", async () => {
    env.NODE_ENV = "production";
    await postEverywhere();
    const hosts = fetchSpy.mock.calls.map(([url]) => new URL(String(url)).hostname);
    expect(hosts).toContain("discord.com");
    expect(hosts).toContain("graph.facebook.com");
    expect(hosts).toContain("oauth.reddit.com");
    expect(hosts).toContain("api.twitter.com");
  });
});
