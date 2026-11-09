import { rateLimitResponse } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { DISCORD_INDEFINITE_SANCTION_DAYS } from "@/drizzle/constants";
import {
  actionLog,
  discordLink,
  discordLinkHistory,
  sanctionTombstone,
  userData,
  userReport,
} from "@/drizzle/schema";
import { GET as authorizeDiscord } from "@/app/api/discord/authorize/route";
import { DISCORD_RELINK_REQUIRED, needsDiscordRelink } from "@/libs/discordLink";
import { discordRouter } from "@/server/api/routers/discord";
import { deleteUser } from "@/server/utils/accountDeletion/deleteUserData";
import { getDiscordConfig } from "@/server/utils/discord/config";
import {
  archiveDiscordLink,
  discordTombstoneHash,
  insertDiscordLink,
  loadLinkCandidate,
} from "@/server/utils/discord/links";
import {
  completeDiscordLink,
  exchangeDiscordCode,
  resolveClerkDiscordGrant,
} from "@/server/utils/discord/linking";
import { encryptToken } from "@/server/utils/discord/secrets";
import {
  fetchLinksNeedingSync,
  reconcileDiscordLinks,
  syncDiscordMember,
} from "@/server/utils/discord/sync";
import { recordSanctionTombstone } from "@/server/utils/sanctionTombstone";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
} from "../../../setup/testDatabase";
import { restoreEnvAfterEach } from "../../../setup/env";

const DAY = 86_400_000;
const GUILD = "2222222222222222222";
const VILLAGE_ROLE = "5555555555555555555";
const VERIFIED_ROLE = "6666666666666666666";
/** Created 2016, well past the minimum account age. */
const OLD_DISCORD = "175928847299117063";
const OTHER_DISCORD = "175928847299117064";
const KEY = Buffer.alloc(32, 9);

const ENV = {
  DISCORD_LINKING_ENABLED: "true",
  DISCORD_CLIENT_ID: "1111111111111111111",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_GUILD_ID: GUILD,
  DISCORD_VERIFIED_ROLE_ID: VERIFIED_ROLE,
  DISCORD_VILLAGE_ROLE_IDS: JSON.stringify({ "village-a": VILLAGE_ROLE }),
  DISCORD_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
};

type Call = {
  method: string;
  path: string;
  body: unknown;
  reason: string | null;
  auth: string | null;
};
let calls: Call[] = [];
let guildMember: { nick: string | null; roles: string[] } | null = null;
/** What Discord reports for a bearer token at /oauth2/@me. */
let authorization = {
  application: { id: "1111111111111111111" },
  scopes: ["identify", "role_connections.write", "guilds.join"],
  expires: "2030-01-01T00:00:00.000Z",
  user: { id: OLD_DISCORD, username: "naruto_fan" },
};

/** A small fake of the Discord endpoints the feature calls. */
const fakeDiscord = (user = { id: OLD_DISCORD, username: "naruto_fan" }) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    // Public procedures (getStatus) pass the rate limiter: let every call through.
    const rateLimit = rateLimitResponse(init);
    if (rateLimit) return rateLimit;
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v10", "");
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body =
      typeof init?.body === "string" && headers["Content-Type"] === "application/json"
        ? JSON.parse(init.body)
        : init?.body
          ? Object.fromEntries(new URLSearchParams(String(init.body)))
          : null;
    calls.push({
      method,
      path,
      body,
      reason: headers["X-Audit-Log-Reason"]
        ? decodeURIComponent(headers["X-Audit-Log-Reason"])
        : null,
      auth: headers.Authorization ?? null,
    });
    const ok = (data: unknown, status = 200) =>
      new Response(data === null ? null : JSON.stringify(data), { status });
    if (path === "/oauth2/token")
      return ok({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 604800,
        scope: "identify role_connections.write guilds.join",
        token_type: "Bearer",
      });
    if (path === "/oauth2/token/revoke") return ok({});
    if (path === "/oauth2/@me") return ok(authorization);
    if (path === "/users/@me") return ok(user);
    if (path.endsWith("/role-connection")) return ok({});
    if (path.startsWith(`/guilds/${GUILD}/members/`) && method === "GET")
      return guildMember
        ? ok(guildMember)
        : ok({ code: 10007, message: "Unknown Member" }, 404);
    if (path.startsWith(`/guilds/${GUILD}/members/`) && method === "PUT" && !path.includes("/roles/"))
      return ok({ roles: [] }, 201);
    return ok(null, 204);
  }) as unknown as typeof fetch);
};

const linkValues = (userId: string, discordId: string) => ({
  id: `link-${userId}`,
  userId,
  discordId,
  discordUsername: `discord-${userId}`,
  discordCreatedAt: new Date("2016-04-30T11:18:25.796Z"),
  accessToken: encryptToken("access-0", KEY),
  refreshToken: encryptToken("refresh-0", KEY),
  tokenExpiresAt: new Date(Date.now() + 7 * DAY),
  scopes: "identify role_connections.write guilds.join",
});

/** The OAuth callback: exchange the code, then link. */
const linkThroughOAuth = async (
  userId: string,
  identity: Parameters<typeof completeDiscordLink>[2]["identity"],
) => {
  const config = getDiscordConfig();
  if (!config) throw new Error("config");
  const grant = await exchangeDiscordCode(config, "code-1");
  if (!grant) throw new Error("grant");
  return completeDiscordLink(await getTestDatabase(), config, { userId, grant, identity });
};

type ClerkToken = { token: string; scopes: string[]; externalAccountId: string };

/** Fake Clerk Backend API holding a Discord sign-in for every user. */
const fakeClerk = (
  options: { discordId?: string | null; tokens?: ClerkToken[] } = {},
) => {
  const discordId = options.discordId === undefined ? OLD_DISCORD : options.discordId;
  const tokens = options.tokens ?? [
    {
      token: "clerk-access",
      scopes: ["identify", "email", "role_connections.write", "guilds.join"],
      externalAccountId: "eac_discord",
    },
  ];
  const getUserOauthAccessToken = vi.fn(async () => ({
    data: discordId ? tokens : [],
    totalCount: tokens.length,
  }));
  vi.spyOn(clerk, "clerkClient").mockResolvedValue({
    users: {
      getUser: vi.fn(async () => ({
        primaryEmailAddressId: null,
        emailAddresses: [],
        externalAccounts: discordId
          ? [{ id: "eac_discord", provider: "oauth_discord", providerUserId: discordId }]
          : [],
      })),
      getUserOauthAccessToken,
    },
  } as unknown as Awaited<ReturnType<typeof clerk.clerkClient>>);
  return { getUserOauthAccessToken };
};

/** Headers of a click on one of our own links. */
const NAVIGATION = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

const clerkIdentity = (discordId = OLD_DISCORD) => ({
  primaryEmailAddressId: null,
  emailAddresses: [],
  externalAccounts: [{ provider: "oauth_discord", providerUserId: discordId }],
});

const addSanction = async (
  userId: string,
  status: "BAN_ACTIVATED" | "SILENCE_ACTIVATED",
  days: number,
  id = `report-${userId}`,
  decidedDaysAgo = 0,
) =>
  (await getTestDatabase()).insert(userReport).values({
    id,
    reporterUserId: "staff",
    reportedUserId: userId,
    system: "tavern_comment",
    infraction: {},
    reason: "Spam",
    aiInterpretation: "",
    status,
    banEnd: new Date(Date.now() + days * DAY),
    updatedAt: new Date(Date.now() - decidedDaysAgo * DAY),
  });

describeWithDatabase("Discord links (SQL)", () => {
  restoreEnvAfterEach(...Object.keys(ENV));
  beforeEach(async () => {
    Object.assign(process.env, ENV);
    calls = [];
    guildMember = null;
    authorization = {
      ...authorization,
      application: { id: ENV.DISCORD_CLIENT_ID },
      scopes: ["identify", "role_connections.write", "guilds.join"],
      user: { id: OLD_DISCORD, username: "naruto_fan" },
    };
    fakeDiscord();
    await resetTables(
      userData,
      discordLink,
      discordLinkHistory,
      userReport,
      sanctionTombstone,
      actionLog,
    );
    await insertUsers([
      { userId: "user-a", username: "Alpha", level: 20, villageId: "village-a" },
      { userId: "user-b", username: "Bravo", level: 30 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps one link per character and at most two per Discord account", async () => {
    const database = await getTestDatabase();
    expect(await indexColumns("DiscordLink", "DiscordLink_userId_key")).toEqual({
      columns: ["userId"],
      unique: true,
    });
    expect(await indexColumns("DiscordLink", "DiscordLink_discordId_slot_key")).toEqual({
      columns: ["discordId", "slot"],
      unique: true,
    });
    expect(await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD))).toBe(true);
    expect(
      await insertDiscordLink(database, {
        ...linkValues("user-a", OTHER_DISCORD),
        id: "second-link-for-user",
      }),
    ).toBe(false);
    // A link written without a slot takes slot 1.
    expect(await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD))).toBe(false);
    expect(
      await insertDiscordLink(database, { ...linkValues("user-b", OLD_DISCORD), slot: 2 }),
    ).toBe(true);
    expect((await database.query.discordLink.findFirst({ where: eq(discordLink.userId, "user-a") }))).toMatchObject({ slot: 1, isPrimary: true });
  });

  it("lets exactly one of two concurrent links for the same Discord account win", async () => {
    const database = await getTestDatabase();
    const results = await Promise.all([
      insertDiscordLink(database, linkValues("user-a", OLD_DISCORD)),
      insertDiscordLink(database, linkValues("user-b", OLD_DISCORD)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await database.query.discordLink.findMany()).toHaveLength(1);
  });

  it("archives a link exactly once, so retries are safe", async () => {
    const database = await getTestDatabase();
    const values = linkValues("user-a", OLD_DISCORD);
    await insertDiscordLink(database, values);
    const link = { ...values, linkedAt: new Date() };
    expect(await archiveDiscordLink(database, link, "USER")).toBe(true);
    expect(await archiveDiscordLink(database, link, "USER")).toBe(false);
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ id: values.id, userId: "user-a", reason: "USER" }),
    ]);
  });

  it("loads cooldown history, blocking sanctions and tombstone matches", async () => {
    const database = await getTestDatabase();
    await database.insert(discordLinkHistory).values({
      id: "old-link",
      userId: "user-b",
      discordId: OLD_DISCORD,
      discordUsername: "old",
      linkedAt: new Date(Date.now() - 10 * DAY),
      unlinkedAt: new Date(Date.now() - DAY),
      reason: "USER",
    });
    await database.insert(sanctionTombstone).values({
      userId: "deleted-user",
      sourceId: "report-deleted",
      sanction: "BAN",
      sanctionEndsAt: new Date(Date.now() + 100 * DAY),
      accountHashes: [discordTombstoneHash(OLD_DISCORD)],
    });
    await addSanction("user-a", "SILENCE_ACTIVATED", DISCORD_INDEFINITE_SANCTION_DAYS + 30);
    const { candidate } = await loadLinkCandidate(database, {
      userId: "user-a",
      discordId: OLD_DISCORD,
      discordCreatedAt: new Date("2016-04-30T11:18:25.796Z"),
    });
    expect(candidate.history).toHaveLength(1);
    expect(candidate.matchesSanctionTombstone).toBe(true);
    expect(candidate.hasBlockingSanction).toBe(true);
    // A short silence neither blocks linking nor bans on Discord.
    await resetTables(userReport);
    await addSanction("user-a", "SILENCE_ACTIVATED", 3);
    const shortSilence = await loadLinkCandidate(database, {
      userId: "user-a",
      discordId: OTHER_DISCORD,
      discordCreatedAt: new Date("2016-04-30T11:18:25.796Z"),
    });
    expect(shortSilence.candidate.hasBlockingSanction).toBe(false);
    expect(shortSilence.candidate.matchesSanctionTombstone).toBe(false);
  });

  it("links through the OAuth callback and pushes metadata, nickname and roles", async () => {
    const database = await getTestDatabase();
    const outcome = await linkThroughOAuth("user-a", clerkIdentity(OTHER_DISCORD));
    expect(outcome).toEqual({ result: "linked" });
    const link = await database.query.discordLink.findFirst({
      where: eq(discordLink.userId, "user-a"),
    });
    expect(link).toMatchObject({
      tokenSource: "OAUTH",
      discordId: OLD_DISCORD,
      discordUsername: "naruto_fan",
      clerkDiscordId: OTHER_DISCORD,
      syncedUsername: "Alpha",
      syncedVillageId: "village-a",
      syncedLevel: 20,
      syncError: null,
    });
    // Tokens are stored encrypted.
    expect(link?.accessToken).not.toContain("access-1");
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.body).toEqual({
      platform_name: "TheNinja-RPG",
      platform_username: "Alpha",
      metadata: { linked: "1", level: "20" },
    });
    expect(
      calls.find((call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/members/${OLD_DISCORD}`)
        ?.body,
    ).toEqual({ access_token: "access-1", nick: "Alpha", roles: [VERIFIED_ROLE, VILLAGE_ROLE] });
    const logs = await database.query.actionLog.findMany({
      where: eq(actionLog.tableName, "discordLink"),
    });
    expect(logs.map((log) => log.relatedMsg)).toEqual(
      expect.arrayContaining([
        "Linked Discord naruto_fan",
        expect.stringContaining("Discord link flag"),
      ]),
    );
  });

  it("links a second character to a linked Discord account, keeping its primary", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    guildMember = { nick: "Bravo", roles: [VERIFIED_ROLE] };
    const outcome = await linkThroughOAuth("user-a", clerkIdentity(OLD_DISCORD));
    expect(outcome).toEqual({ result: "linked_second" });
    expect(
      await database.query.discordLink.findFirst({ where: eq(discordLink.userId, "user-a") }),
    ).toMatchObject({ slot: 2, isPrimary: false, syncError: null, syncedUsername: "Bravo" });
    // The account keeps showing the primary: Bravo's metadata, nickname and roles.
    expect(calls.find((call) => call.path.endsWith("/role-connection"))).toMatchObject({
      auth: "Bearer access-0",
      body: { platform_username: "Bravo", metadata: { linked: "1", level: "30" } },
    });
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
    const logs = await database.query.actionLog.findMany({
      where: eq(actionLog.tableName, "discordLink"),
    });
    expect(logs.map((log) => [log.relatedId, log.relatedMsg])).toEqual(
      expect.arrayContaining([
        ["user-a", "Linked Discord naruto_fan as second character of Bravo"],
        ["user-b", "Alpha linked the same Discord naruto_fan"],
      ]),
    );
    // A Discord login shared with the declared sibling is no abuse flag.
    expect(logs.some((log) => log.relatedMsg?.startsWith("Discord link flag"))).toBe(false);
    const status = await (await callerFor(discordRouter, "user-a")).getStatus();
    expect(status.link).toMatchObject({ isPrimary: false, sibling: "Bravo" });
  });

  it("refuses a third character without revoking the shared authorization", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "user-c", username: "Charlie", level: 5 }]);
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await insertDiscordLink(database, { ...linkValues("user-c", OLD_DISCORD), slot: 2, isPrimary: false });
    const outcome = await linkThroughOAuth("user-a", null);
    expect(outcome).toEqual({ result: "discord_full", hint: "B***o, C*****e" });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
    expect(calls.some((call) => call.path.includes("/guilds/"))).toBe(false);
    expect(await database.query.discordLink.findMany()).toHaveLength(2);
  });

  it("settles concurrent second and third links with at most two links", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "user-c", username: "Charlie", level: 5 }]);
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    const outcomes = await Promise.all([
      linkThroughOAuth("user-a", null),
      linkThroughOAuth("user-c", null),
    ]);
    expect(outcomes.map((outcome) => outcome.result).sort()).toEqual([
      "discord_full",
      "linked_second",
    ]);
    const links = await database.query.discordLink.findMany();
    expect(links).toHaveLength(2);
    expect(links.filter((link) => link.isPrimary).map((link) => link.userId)).toEqual(["user-b"]);
  });

  it("lets either character become primary and syncs the account to it", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await insertDiscordLink(database, { ...linkValues("user-a", OLD_DISCORD), slot: 2, isPrimary: false });
    await syncDiscordMember(database, "user-b", { force: true });
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    guildMember = { nick: "Bravo", roles: [VERIFIED_ROLE] };
    calls = [];
    const caller = await callerFor(discordRouter, "user-a");
    expect((await caller.setPrimary()).success).toBe(true);
    expect((await caller.setPrimary()).success).toBe(false);
    const links = await database.query.discordLink.findMany();
    expect(links.find((link) => link.userId === "user-a")?.isPrimary).toBe(true);
    expect(links.find((link) => link.userId === "user-b")?.isPrimary).toBe(false);
    expect((await (await callerFor(discordRouter, "user-b")).getStatus()).link).toMatchObject({
      isPrimary: false,
      sibling: "Alpha",
    });
    // setPrimary schedules the sync; outside a request it runs right away in the background.
    for (let i = 0; i < 50 && (await fetchLinksNeedingSync(database, 10)).length > 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.body).toMatchObject({
      platform_username: "Alpha",
      metadata: { linked: "1", level: "20" },
    });
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ nick: "Alpha" });
    expect(calls.some((call) => call.method === "PUT" && call.path.endsWith(`/roles/${VILLAGE_ROLE}`))).toBe(true);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
  });

  it("promotes the other character when the primary unlinks, keeping the shared token", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await insertDiscordLink(database, { ...linkValues("user-a", OLD_DISCORD), slot: 2, isPrimary: false });
    guildMember = { nick: "Bravo", roles: [VERIFIED_ROLE] };
    expect((await (await callerFor(discordRouter, "user-b")).unlink()).success).toBe(true);
    expect(await database.query.discordLink.findMany()).toEqual([
      expect.objectContaining({ userId: "user-a", isPrimary: true, slot: 2 }),
    ]);
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
    const connections = calls.filter((call) => call.path.endsWith("/role-connection"));
    expect(connections.map((call) => call.body)).toEqual([
      expect.objectContaining({ platform_username: "Alpha", metadata: { linked: "1", level: "20" } }),
    ]);
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ nick: "Alpha" });
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ userId: "user-b", discordId: OLD_DISCORD }),
    ]);
    // Unlinking the last remaining character clears the metadata and revokes the token.
    calls = [];
    expect((await (await callerFor(discordRouter, "user-a")).unlink()).success).toBe(true);
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.body).toMatchObject({
      metadata: { linked: "0" },
    });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(true);
  });

  it("undoes the Discord side when both characters unlink at once", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await insertDiscordLink(database, { ...linkValues("user-a", OLD_DISCORD), slot: 2, isPrimary: false });
    guildMember = { nick: "Bravo", roles: [VERIFIED_ROLE] };
    const results = await Promise.all([
      (await callerFor(discordRouter, "user-a")).unlink(),
      (await callerFor(discordRouter, "user-b")).unlink(),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(
      calls.some(
        (call) =>
          call.path.endsWith("/role-connection") &&
          (call.body as { metadata: { linked: string } }).metadata.linked === "0",
      ),
    ).toBe(true);
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(true);
  });

  it("bans the account while either character is sanctioned and unbans when neither is", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await insertDiscordLink(database, { ...linkValues("user-a", OLD_DISCORD), slot: 2, isPrimary: false });
    await syncDiscordMember(database, "user-b", { force: true });
    // The secondary character's sanction bans the shared account.
    await addSanction("user-a", "BAN_ACTIVATED", DISCORD_INDEFINITE_SANCTION_DAYS + 1, "report-a");
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(2);
    calls = [];
    expect(await reconcileDiscordLinks(database)).toMatchObject({ processed: 1, failed: 0 });
    expect(calls.filter((call) => call.method === "PUT" && call.path.includes("/bans/"))).toEqual([
      expect.objectContaining({ reason: "TNR report report-a: indefinite ban" }),
    ]);
    expect((await database.query.discordLink.findMany()).every((link) => link.syncedBanned)).toBe(true);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    // An unsanctioned character cannot join a Discord account banned through its sibling.
    await insertUsers([{ userId: "user-c", username: "Charlie", level: 5 }]);
    await database.delete(discordLink).where(eq(discordLink.userId, "user-b"));
    expect(await linkThroughOAuth("user-c", null)).toEqual({ result: "blocked" });
    await insertDiscordLink(database, { ...linkValues("user-b", OLD_DISCORD), syncedBanned: true });
    // Both sanctioned: clearing one keeps the ban.
    await addSanction("user-b", "SILENCE_ACTIVATED", DISCORD_INDEFINITE_SANCTION_DAYS + 1, "report-b");
    await database.update(userReport).set({ status: "REPORT_CLEARED" }).where(eq(userReport.id, "report-a"));
    calls = [];
    await syncDiscordMember(database, "user-a");
    expect(calls.some((call) => call.method === "DELETE" && call.path.includes("/bans/"))).toBe(false);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    await database.update(userReport).set({ status: "REPORT_CLEARED" }).where(eq(userReport.id, "report-b"));
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(2);
    await reconcileDiscordLinks(database);
    expect(calls.filter((call) => call.method === "DELETE" && call.path.includes("/bans/"))).toHaveLength(1);
    expect((await database.query.discordLink.findMany()).some((link) => link.syncedBanned)).toBe(false);
  });

  it("keeps the ban after the sanctioned sibling is deleted", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, { ...linkValues("user-b", OLD_DISCORD), syncedBanned: true });
    await database.insert(sanctionTombstone).values({
      userId: "user-deleted",
      sourceId: "report-deleted",
      sanction: "BAN",
      sanctionEndsAt: new Date(Date.now() + (DISCORD_INDEFINITE_SANCTION_DAYS + 5) * DAY),
      accountHashes: [discordTombstoneHash(OLD_DISCORD)],
    });
    expect((await syncDiscordMember(database, "user-b", { force: true })).synced).toBe(true);
    expect(calls.find((call) => call.method === "PUT" && call.path.includes("/bans/"))?.reason).toBe(
      "TNR report report-deleted: indefinite sanction of a deleted linked account",
    );
    expect(calls.some((call) => call.method === "DELETE" && call.path.includes("/bans/"))).toBe(false);
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(true);
  });

  it("refuses a different third character while an unlinked one still counts", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "user-c", username: "Charlie", level: 5 }]);
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await database.insert(discordLinkHistory).values({
      id: "old-link",
      userId: "user-c",
      discordId: OLD_DISCORD,
      discordUsername: "naruto_fan",
      linkedAt: new Date(Date.now() - 10 * DAY),
      unlinkedAt: new Date(Date.now() - DAY),
      reason: "USER",
    });
    expect(await linkThroughOAuth("user-a", null)).toMatchObject({ result: "cooldown" });
    // The unlinked character itself may come back.
    expect(await linkThroughOAuth("user-c", null)).toEqual({ result: "linked_second" });
  });

  it("shows staff both characters of a Discord account", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "staff", username: "Staffer", role: "MODERATOR" }]);
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    await insertDiscordLink(database, { ...linkValues("user-a", OLD_DISCORD), slot: 2, isPrimary: false });
    const caller = await callerFor(discordRouter, "staff");
    for (const query of [OLD_DISCORD, "Alpha"]) {
      const { links } = await caller.searchLinks({ query });
      expect(
        links.map((link) => ({
          userId: link.userId,
          isPrimary: link.isPrimary,
          sameOwner: link.sameOwner.map((other) => other.username),
        })),
      ).toEqual([
        { userId: "user-b", isPrimary: true, sameOwner: ["Alpha"] },
        { userId: "user-a", isPrimary: false, sameOwner: ["Bravo"] },
      ]);
    }
  });

  it("refuses linking while banned", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ isBanned: true }).where(eq(userData.userId, "user-a"));
    expect(await linkThroughOAuth("user-a", null)).toEqual({ result: "banned" });
  });

  it("bans the linked Discord account for an indefinite sanction and unbans when lifted", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    await addSanction("user-a", "BAN_ACTIVATED", DISCORD_INDEFINITE_SANCTION_DAYS + 1, "report-42");
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(1);
    expect((await syncDiscordMember(database, "user-a")).synced).toBe(true);
    const ban = calls.find((call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/bans/${OLD_DISCORD}`);
    expect(ban?.reason).toBe("TNR report report-42: indefinite ban");
    expect(
      (await database.query.discordLink.findFirst())?.syncedBanned,
    ).toBe(true);
    // Unlinking is refused while the sanction runs.
    const caller = await callerFor(discordRouter, "user-a");
    expect((await caller.unlink()).success).toBe(false);

    await database
      .update(userReport)
      .set({ status: "REPORT_CLEARED" })
      .where(eq(userReport.id, "report-42"));
    calls = [];
    await reconcileDiscordLinks(database);
    expect(
      calls.some((call) => call.method === "DELETE" && call.path === `/guilds/${GUILD}/bans/${OLD_DISCORD}`),
    ).toBe(true);
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(false);
  });

  it("keeps a long ban indefinite after less than the window remains", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    // A two-year ban decided 400 days ago still has 330 days to run.
    await addSanction("user-a", "BAN_ACTIVATED", 330, "report-long", 400);
    await syncDiscordMember(database, "user-a");
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(true);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    // A one-month ban decided today is not indefinite.
    await resetTables(userReport);
    await addSanction("user-a", "BAN_ACTIVATED", 30, "report-short");
    await syncDiscordMember(database, "user-a");
    expect((await database.query.discordLink.findFirst())?.syncedBanned).toBe(false);
  });

  it("re-applies a changed username and village role on the next sync", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    guildMember = { nick: "Alpha", roles: [VERIFIED_ROLE, VILLAGE_ROLE, "7777777777777777777"] };
    await syncDiscordMember(database, "user-a", { force: true });
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
    await database
      .update(userData)
      .set({ username: "AlphaRenamed", villageId: "village-b" })
      .where(eq(userData.userId, "user-a"));
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(1);
    calls = [];
    await reconcileDiscordLinks(database);
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ nick: "AlphaRenamed" });
    // The old village role goes; unmanaged roles stay.
    expect(
      calls.filter((call) => call.method === "DELETE").map((call) => call.path),
    ).toEqual([`/guilds/${GUILD}/members/${OLD_DISCORD}/roles/${VILLAGE_ROLE}`]);
    expect(await fetchLinksNeedingSync(database, 10)).toHaveLength(0);
  });

  it("does nothing on Discord while the feature is off", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    process.env.DISCORD_LINKING_ENABLED = "false";
    expect(await reconcileDiscordLinks(database)).toEqual({
      processed: 0,
      failed: 0,
      skipped: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("unlinks: drops the Linked Role, archives the link and logs it", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    guildMember = { nick: "Alpha", roles: [VILLAGE_ROLE] };
    const caller = await callerFor(discordRouter, "user-a");
    expect((await caller.unlink()).success).toBe(true);
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.body).toMatchObject({
      metadata: { linked: "0", level: "0" },
    });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(true);
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ userId: "user-a", discordId: OLD_DISCORD, reason: "USER" }),
    ]);
  });

  it("captures the linked Discord id in the tombstone and removes the link on deletion", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, linkValues("user-a", OLD_DISCORD));
    await addSanction("user-a", "BAN_ACTIVATED", 20);
    await recordSanctionTombstone(database, "user-a", {
      primaryEmailAddressId: null,
      emailAddresses: [],
      externalAccounts: [],
    });
    expect((await database.query.sanctionTombstone.findFirst())?.accountHashes).toEqual([
      discordTombstoneHash(OLD_DISCORD),
    ]);
    // Without an active report deletion never asks Clerk for the identity.
    await database.delete(userReport);
    await deleteUser(database, "user-a");
    expect(await database.query.discordLink.findMany()).toHaveLength(0);
    expect(await database.query.discordLinkHistory.findMany()).toEqual([
      expect.objectContaining({ userId: "user-a", reason: "ACCOUNT_DELETED" }),
    ]);
  });

  it("links from the Clerk Discord sign-in without a consent redirect", async () => {
    const database = await getTestDatabase();
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    fakeClerk();
    const grant = await resolveClerkDiscordGrant(config, "user-a");
    expect(grant).toMatchObject({ source: "CLERK", accessToken: "clerk-access", tokens: null });
    if (!grant) throw new Error("grant");
    const outcome = await completeDiscordLink(database, config, {
      userId: "user-a",
      grant,
      identity: clerkIdentity(),
    });
    expect(outcome).toEqual({ result: "linked" });
    const link = await database.query.discordLink.findFirst();
    expect(link).toMatchObject({
      userId: "user-a",
      discordId: OLD_DISCORD,
      clerkDiscordId: OLD_DISCORD,
      tokenSource: "CLERK",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      syncError: null,
      syncedLevel: 20,
    });
    // Clerk's token pushes metadata and joins the server; no code exchange or revoke.
    expect(calls.some((call) => call.path.startsWith("/oauth2/token"))).toBe(false);
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.auth).toBe(
      "Bearer clerk-access",
    );
    expect(
      calls.find(
        (call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/members/${OLD_DISCORD}`,
      )?.body,
    ).toMatchObject({ access_token: "clerk-access" });
    expect(needsDiscordRelink(link?.syncError)).toBe(false);
  });

  it("completes the link in the authorize route when Clerk's token has the scope", async () => {
    fakeClerk();
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId: "user-a" } as never);
    const response = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: NAVIGATION,
      }),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/discord/link?result=linked&auto=1",
    );
    expect((await (await getTestDatabase()).query.discordLink.findFirst())?.tokenSource).toBe(
      "CLERK",
    );
  });

  it("falls back to the consent redirect when Clerk's token lacks the scope", async () => {
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    fakeClerk({
      tokens: [{ token: "old", scopes: ["identify", "email"], externalAccountId: "eac_discord" }],
    });
    expect(await resolveClerkDiscordGrant(config, "user-a")).toBeNull();
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId: "user-a" } as never);
    const response = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: NAVIGATION,
      }),
    );
    expect(response.headers.get("location")).toStartWith("https://discord.com/oauth2/authorize");
    expect(await (await getTestDatabase()).query.discordLink.findMany()).toHaveLength(0);
  });

  it("uses the consent flow without a Discord sign-in, for a foreign token or a non-click start", async () => {
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    fakeClerk({ discordId: null });
    expect(await resolveClerkDiscordGrant(config, "user-a")).toBeNull();
    // A token Discord issued to another application cannot write this app's role connection.
    fakeClerk();
    authorization = { ...authorization, application: { id: "9999999999999999999" } };
    expect(await resolveClerkDiscordGrant(config, "user-a")).toBeNull();
    // Another site sending the player to the route never links without consent.
    authorization = { ...authorization, application: { id: ENV.DISCORD_CLIENT_ID } };
    vi.spyOn(clerk, "auth").mockResolvedValue({ userId: "user-a" } as never);
    const response = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: { ...NAVIGATION, "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.headers.get("location")).toStartWith("https://discord.com/oauth2/authorize");
    // Nor does an image in user content on our own pages.
    const image = await authorizeDiscord(
      new Request("http://localhost:3000/api/discord/authorize", {
        headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" },
      }),
    );
    expect(image.headers.get("location")).toStartWith("https://discord.com/oauth2/authorize");
    expect(await (await getTestDatabase()).query.discordLink.findMany()).toHaveLength(0);
  });

  it("applies the linking rules to Clerk grants and never revokes Clerk's token", async () => {
    const database = await getTestDatabase();
    const config = getDiscordConfig();
    if (!config) throw new Error("config");
    await insertDiscordLink(database, linkValues("user-b", OLD_DISCORD));
    fakeClerk();
    const grant = await resolveClerkDiscordGrant(config, "user-a");
    if (!grant) throw new Error("grant");
    expect(
      await completeDiscordLink(database, config, {
        userId: "user-a",
        grant,
        identity: clerkIdentity(),
      }),
    ).toEqual({ result: "linked_second" });
    await database.update(userData).set({ isBanned: true }).where(eq(userData.userId, "user-a"));
    await resetTables(discordLink);
    expect(
      await completeDiscordLink(database, config, {
        userId: "user-a",
        grant,
        identity: clerkIdentity(),
      }),
    ).toEqual({ result: "banned" });
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
  });

  it("syncs a Clerk-sourced link with a fresh token from Clerk", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, {
      ...linkValues("user-a", OLD_DISCORD),
      tokenSource: "CLERK",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: "identify role_connections.write",
    });
    const { getUserOauthAccessToken } = fakeClerk();
    expect((await syncDiscordMember(database, "user-a", { force: true })).synced).toBe(true);
    expect(getUserOauthAccessToken).toHaveBeenCalledWith("user-a", "discord");
    expect(calls.find((call) => call.path.endsWith("/role-connection"))?.auth).toBe(
      "Bearer clerk-access",
    );
    // guilds.join granted to Clerk later is picked up and used to join the server.
    const link = await database.query.discordLink.findFirst();
    expect(link?.scopes).toBe("identify email role_connections.write guilds.join");
    expect(
      calls.some(
        (call) => call.method === "PUT" && call.path === `/guilds/${GUILD}/members/${OLD_DISCORD}`,
      ),
    ).toBe(true);
    // Unlinking leaves Clerk's token alone.
    calls = [];
    expect((await (await callerFor(discordRouter, "user-a")).unlink()).success).toBe(true);
    expect(calls.some((call) => call.path === "/oauth2/token/revoke")).toBe(false);
  });

  it("asks for a re-link when Clerk no longer holds a usable token", async () => {
    const database = await getTestDatabase();
    await insertDiscordLink(database, {
      ...linkValues("user-a", OLD_DISCORD),
      tokenSource: "CLERK",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
    });
    // The player replaced their Discord sign-in with another Discord account.
    fakeClerk({ discordId: OTHER_DISCORD });
    const result = await syncDiscordMember(database, "user-a", { force: true });
    expect(result.synced).toBe(false);
    expect(calls.some((call) => call.path.endsWith("/role-connection"))).toBe(false);
    const link = await database.query.discordLink.findFirst();
    expect(link?.syncError).toContain(DISCORD_RELINK_REQUIRED);
    // The profile reads this to offer "Re-link Discord".
    expect(needsDiscordRelink(link?.syncError)).toBe(true);
  });
});
