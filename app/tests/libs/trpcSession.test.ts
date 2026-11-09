import { describe, expect, it, mock } from "bun:test";
import type { Clerk } from "@clerk/nextjs/types";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/api/root";
import {
  createTrpcSession,
  SESSION_CHANGED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  trpcSessionUserId,
  TRPC_ANONYMOUS_HEADER,
  trpcSessionLink,
} from "@/libs/trpcSession";
import { deferred } from "../setup/deferred";

const session = (id: string, getToken = async (): Promise<string | null> => id) =>
  ({ id, getToken }) as NonNullable<Clerk["session"]>;

describe("tRPC session authentication", () => {
  it("reads the live session after hydration and refreshes its token for every batch", async () => {
    const clerk: Pick<Clerk, "session"> = { session: undefined };
    const scope = createTrpcSession(clerk);
    const headers = scope.headers;
    let sent = false;
    const pending = headers().then((value) => { sent = true; return value; });
    await Promise.resolve();
    expect(sent).toBe(false);
    const getToken = mock(async () => "token_a");
    clerk.session = session("a", getToken);
    scope.observeSession("a");
    expect(await pending).toEqual({ Authorization: "Bearer token_a" });
    expect(await headers()).toEqual({ Authorization: "Bearer token_a" });
    getToken.mockResolvedValue("refreshed_a");
    expect(await headers()).toEqual({ Authorization: "Bearer refreshed_a" });
  });

  it("authenticates batched queries and mutations with the tab's session", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({
        url: "http://localhost/api/trpc",
        transformer: superjson,
        headers: createTrpcSession({ session: session("token_a") }).headers,
        fetch: async (url, init) => {
          requests.push({ url: String(url), authorization: new Headers(init?.headers).get("Authorization") });
          return Response.json([{ result: { data: superjson.serialize({ success: true }) } }]);
        },
      })],
    });
    await Promise.all([
      client.profile.getUser.query(),
      client.profile.updatePreferences.mutate({ musicOn: false }),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.every(({ authorization }) => authorization === "Bearer token_a")).toBe(true);
    expect(requests.some(({ url }) => url.includes("profile.getUser"))).toBe(true);
    expect(requests.some(({ url }) => url.includes("profile.updatePreferences"))).toBe(true);
  });

  it("keeps signed-out public requests available", async () => {
    expect(await createTrpcSession({ session: null }).headers()).toEqual({ [TRPC_ANONYMOUS_HEADER]: "1" });
  });

  it.each(["switch", "sign-out"])("rejects an old client's queued request after %s", async (change) => {
    const clerk: Pick<Clerk, "session"> = { session: session("a") };
    const { headers } = createTrpcSession(clerk);
    await headers();
    clerk.session = change === "switch" ? session("b") : null;
    await expect(headers()).rejects.toThrow(SESSION_CHANGED_MESSAGE);
    expect(await createTrpcSession(clerk).headers()).toEqual(
      change === "switch" ? { Authorization: "Bearer b" } : { [TRPC_ANONYMOUS_HEADER]: "1" },
    );
  });

  it("rejects a switch before a new client's first batch is sent", async () => {
    const clerk: Pick<Clerk, "session"> = { session: session("a") };
    const { headers } = createTrpcSession(clerk);
    clerk.session = session("b");
    await expect(headers()).rejects.toThrow(SESSION_CHANGED_MESSAGE);
  });

  it.each(["switch", "sign-out"])("rejects a %s while obtaining a token", async (change) => {
    let resolveToken!: (value: string) => void;
    const clerk: Pick<Clerk, "session"> = {
      session: session("a", () => new Promise((resolve) => { resolveToken = resolve; })),
    };
    const pending = createTrpcSession(clerk).headers();
    clerk.session = change === "switch" ? session("b") : null;
    resolveToken("token_a");
    await expect(pending).rejects.toThrow(SESSION_CHANGED_MESSAGE);
  });

  it("never falls back to another tab's cookie when token acquisition fails", async () => {
    await expect(createTrpcSession({ session: session("a", async () => null) }).headers())
      .rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    await expect(createTrpcSession({ session: session("a", async () => { throw new Error("Offline"); }) }).headers())
      .rejects.toThrow("Offline");
  });
});


describe("tRPC account lifetime", () => {
  it.each(["switch", "sign-out"])("rejects a queued push registration after %s before dispatch", async (change) => {
    const clerk: Pick<Clerk, "session"> = { session: session("a") };
    const scope = createTrpcSession(clerk);
    const fetch = mock(async () => Response.json([]));
    const client = createTRPCClient<AppRouter>({
      links: [trpcSessionLink(scope), httpBatchLink({
        url: "http://localhost/api/trpc", transformer: superjson, headers: scope.headers, fetch,
      })],
    });
    clerk.session = change === "switch" ? session("b") : null;
    await expect(client.push.registerDevice.mutate({ token: "a".repeat(64), platform: "ios" }))
      .rejects.toThrow(SESSION_CHANGED_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("permanently rejects a queued client after switching away and back", async () => {
    const clerk: Pick<Clerk, "session"> = { session: session("a") };
    const scope = createTrpcSession(clerk);
    scope.observeSession("b");
    clerk.session = session("a");
    await expect(scope.headers()).rejects.toThrow(SESSION_CHANGED_MESSAGE);
    expect(() => scope.assertCurrent()).toThrow(SESSION_CHANGED_MESSAGE);
    expect(await createTrpcSession(clerk).headers()).toEqual({ Authorization: "Bearer a" });
  });

  it("treats an anonymous request as signed out even with another tab's session cookie", async () => {
    const headers = new Headers(await createTrpcSession({ session: null }).headers());
    headers.set("cookie", "__session=account_b");
    expect(trpcSessionUserId("account_b", headers)).toBeNull();
    expect(trpcSessionUserId("account_a", new Headers({ Authorization: "Bearer a" }))).toBe("account_a");
  });

  it.each(["query", "mutation"])("discards an in-flight %s response after switching accounts", async (type) => {
    const clerk: Pick<Clerk, "session"> = { session: session("a") };
    const scope = createTrpcSession(clerk);
    let finish!: () => void;
    const { promise: dispatched, resolve: started } = deferred<void>();
    const client = createTRPCClient<AppRouter>({
      links: [trpcSessionLink(scope), httpBatchLink({
        url: "http://localhost/api/trpc", transformer: superjson, headers: scope.headers,
        fetch: async () => {
          started();
          await new Promise<void>((resolve) => { finish = resolve; });
          return Response.json([{ result: { data: superjson.serialize({ success: true, newStatus: "ASLEEP" }) } }]);
        },
      })],
    });
    const pending = type === "query" ? client.profile.getUser.query() : client.home.toggleSleep.mutate();
    await dispatched;
    scope.observeSession("b");
    clerk.session = session("b");
    finish();
    await expect(pending).rejects.toThrow(SESSION_CHANGED_MESSAGE);
  });
});
