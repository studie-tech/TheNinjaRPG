import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  addGuildMember,
  discordRequest,
  getGuildMember,
  isDiscordRequestError,
  setNickname,
  unbanMember,
} from "@/server/utils/discord/rest";
import type { DiscordConfig } from "@/server/utils/discord/config";

const config = {
  clientId: "1111111111111111111",
  clientSecret: "secret",
  botToken: "bot-token",
  guildId: "2222222222222222222",
  verifiedRoleId: null,
  villageRoleIds: {},
  tokenKey: Buffer.alloc(32),
  redirectUri: "http://localhost/api/discord/callback",
} satisfies DiscordConfig;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockFetch = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch");
    return next;
  }) as unknown as typeof fetch;
  return calls;
};

describe("discordRequest", () => {
  it("waits for retry_after on 429 and retries", async () => {
    const calls = mockFetch(
      json(429, { message: "You are being rate limited.", retry_after: 0.01, global: false }),
      json(200, { id: "ok" }),
    );
    const started = Date.now();
    await expect(
      discordRequest({ method: "GET", path: "/users/@me", auth: { bearer: "token" } }),
    ).resolves.toEqual({ id: "ok" });
    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(9);
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token",
    );
  });

  it("gives up after repeated 429s", async () => {
    mockFetch(
      ...Array.from({ length: 4 }, () => json(429, { retry_after: 0.001 })),
    );
    const error = await discordRequest({ method: "GET", path: "/x", auth: null }).catch(
      (cause: unknown) => cause,
    );
    expect(isDiscordRequestError(error) && error.status).toBe(429);
  });

  it("refuses retry waits longer than an invocation can afford", async () => {
    const calls = mockFetch(json(429, { retry_after: 3600 }));
    await expect(discordRequest({ method: "GET", path: "/x", auth: null })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("waits out an exhausted bucket before returning", async () => {
    mockFetch(
      json(200, { ok: true }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.02" }),
    );
    const started = Date.now();
    await discordRequest({ method: "GET", path: "/x", auth: null });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("surfaces status and Discord error codes", async () => {
    mockFetch(json(403, { code: 50013, message: "Missing Permissions" }));
    const error = await setNickname(config, "3333333333333333333", "Nick", "test").catch(
      (cause: unknown) => cause,
    );
    expect(isDiscordRequestError(error) && error.status).toBe(403);
    expect(isDiscordRequestError(error) && error.code).toBe(50013);
  });

  it("sends the bot token and an encoded audit log reason", async () => {
    const calls = mockFetch(new Response(null, { status: 204 }));
    await setNickname(config, "3333333333333333333", "Naruto", "TNR report 1: ban");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bot bot-token");
    expect(headers["X-Audit-Log-Reason"]).toBe(encodeURIComponent("TNR report 1: ban"));
    expect(calls[0]?.init.body).toBe(JSON.stringify({ nick: "Naruto" }));
  });
});

describe("guild helpers", () => {
  it("returns null for members that are not in the server", async () => {
    mockFetch(json(404, { code: 10007, message: "Unknown Member" }));
    expect(await getGuildMember(config, "3333333333333333333")).toBeNull();
  });

  it("distinguishes added members from existing ones", async () => {
    mockFetch(json(201, { roles: [] }), new Response(null, { status: 204 }));
    const member = { accessToken: "token", nick: "Naruto", roles: [] };
    expect(await addGuildMember(config, "3333333333333333333", member)).toBe(true);
    expect(await addGuildMember(config, "3333333333333333333", member)).toBe(false);
  });

  it("treats unbanning a user without a ban as a no-op", async () => {
    mockFetch(json(404, { code: 10026, message: "Unknown Ban" }));
    expect(await unbanMember(config, "3333333333333333333", "lifted")).toBe(false);
  });
});
