// @vitest-environment node
import { randomBytes } from "node:crypto";
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { makeBlockStruggleBridge, type RpgIdentity } from "../blockStruggleBridge";

const config = () => ({
  apiOrigin: "https://puzzle.example",
  siteOrigin: "https://rpg.example",
  cookieKey: randomBytes(32).toString("base64url"),
});
const identity = (sessionId = "rpg-session"): RpgIdentity => ({
  userId: "rpg-user",
  sessionId,
  getToken: async () => "signed.clerk.proof",
});
const request = (path: string, method = "GET", origin = "https://rpg.example") =>
  new Request(`https://rpg.example/api/minigames/blockstruggle/${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify({ opponent: "p_other" }) : undefined,
  });
const issued = (token: string) =>
  Response.json({
    token,
    playerId: "p_player",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

describe("TheNinjaRPG same-origin puzzle bridge", () => {
  it("exchanges once, reuses an encrypted cookie, and binds it to the Clerk session", async () => {
    let exchanges = 0;
    const puzzleTokens: string[] = [];
    const bridge = await Effect.runPromise(
      makeBlockStruggleBridge(config(), async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/ninja/session/exchange") {
          exchanges++;
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer signed.clerk.proof",
          );
          return issued(String(exchanges).repeat(43));
        }
        puzzleTokens.push(new Headers(init?.headers).get("authorization") ?? "");
        return Response.json({ playerId: "p_player" });
      }),
    );
    const first = await Effect.runPromise(
      bridge.handle(request("session"), ["session"], identity()),
    );
    expect(first.response.status).toBe(200);
    expect(first.cookie?.value).toBeTruthy();
    expect(first.cookie?.value).not.toContain("1".repeat(43));
    const second = await Effect.runPromise(
      bridge.handle(request("session"), ["session"], identity(), first.cookie?.value),
    );
    expect(second.cookie).toBeUndefined();
    expect(exchanges).toBe(1);
    const switched = await Effect.runPromise(
      bridge.handle(
        request("session"),
        ["session"],
        identity("new-rpg-session"),
        first.cookie?.value,
      ),
    );
    expect(switched.cookie?.value).toBeTruthy();
    expect(exchanges).toBe(2);
    expect(puzzleTokens).toEqual([
      `Bearer ${"1".repeat(43)}`,
      `Bearer ${"1".repeat(43)}`,
      `Bearer ${"2".repeat(43)}`,
    ]);
  });

  it("rejects unsafe routes and cross-origin writes before issuing a session", async () => {
    let calls = 0;
    const bridge = await Effect.runPromise(
      makeBlockStruggleBridge(config(), async () => {
        calls++;
        return issued("a".repeat(43));
      }),
    );
    const csrf = await Effect.runPromise(
      Effect.either(
        bridge.handle(
          request("matches", "POST", "https://evil.example"),
          ["matches"],
          identity(),
        ),
      ),
    );
    expect(Either.isLeft(csrf) && csrf.left.status).toBe(403);
    const crossSite = request("session");
    crossSite.headers.set("sec-fetch-site", "cross-site");
    const unsafeGet = await Effect.runPromise(
      Effect.either(bridge.handle(crossSite, ["session"], identity())),
    );
    expect(Either.isLeft(unsafeGet) && unsafeGet.left.status).toBe(403);
    const internal = await Effect.runPromise(
      Effect.either(
        bridge.handle(
          request("internal/deletion-worker"),
          ["internal", "deletion-worker"],
          identity(),
        ),
      ),
    );
    expect(Either.isLeft(internal) && internal.left.status).toBe(405);
    expect(calls).toBe(0);
  });

  it("refreshes one revoked game session and clears the cookie on logout", async () => {
    let exchanges = 0;
    let revokes = 0;
    let denyOld = false;
    const bridge = await Effect.runPromise(
      makeBlockStruggleBridge(config(), async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/exchange")) return issued(String(++exchanges).repeat(43));
        if (init?.method === "DELETE") {
          revokes++;
          return new Response(null, { status: 204 });
        }
        const token = new Headers(init?.headers).get("authorization");
        if (denyOld && token === `Bearer ${"1".repeat(43)}`)
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        return Response.json({ playerId: "p_player" });
      }),
    );
    const first = await Effect.runPromise(
      bridge.handle(request("session"), ["session"], identity()),
    );
    denyOld = true;
    const refreshed = await Effect.runPromise(
      bridge.handle(request("session"), ["session"], identity(), first.cookie?.value),
    );
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.cookie?.value).toBeTruthy();
    expect(exchanges).toBe(2);
    const logout = await Effect.runPromise(
      bridge.handle(
        request("session", "DELETE"),
        ["session"],
        identity(),
        refreshed.cookie?.value,
      ),
    );
    expect(logout.response.status).toBe(204);
    expect(logout.clearCookie).toBe(true);
    expect(revokes).toBe(1);
    expect(exchanges).toBe(2);
  });

  it("retains a newly issued session when the first proxied response is lost", async () => {
    let exchanges = 0;
    let failProxy = true;
    const bridge = await Effect.runPromise(
      makeBlockStruggleBridge(config(), async (url) => {
        if (new URL(String(url)).pathname.endsWith("/exchange")) {
          exchanges++;
          return issued("a".repeat(43));
        }
        if (failProxy) {
          failProxy = false;
          throw new TypeError("Simulated upstream transport loss");
        }
        return Response.json({ playerId: "p_player" });
      }),
    );
    const first = await Effect.runPromise(
      bridge.handle(request("session"), ["session"], identity()),
    );
    expect(first.response.status).toBe(502);
    expect(first.cookie?.value).toBeTruthy();
    const retry = await Effect.runPromise(
      bridge.handle(request("session"), ["session"], identity(), first.cookie?.value),
    );
    expect(retry.response.status).toBe(200);
    expect(exchanges).toBe(1);
  });

  it("proxies match results but denies unsupported friendship deletion", async () => {
    const paths: string[] = [];
    const bridge = await Effect.runPromise(
      makeBlockStruggleBridge(config(), async (url) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        return path.endsWith("/exchange")
          ? issued("b".repeat(43))
          : Response.json({ matchId: "m_123" });
      }),
    );
    const result = await Effect.runPromise(
      bridge.handle(
        request("matches/m_123/result"),
        ["matches", "m_123", "result"],
        identity(),
      ),
    );
    expect(result.response.status).toBe(200);
    expect(paths).toEqual([
      "/api/ninja/session/exchange",
      "/api/ninja/matches/m_123/result",
    ]);
    const denied = await Effect.runPromise(
      Effect.either(
        bridge.handle(
          request("friends", "DELETE"),
          ["friends"],
          identity(),
          result.cookie?.value,
        ),
      ),
    );
    expect(Either.isLeft(denied) && denied.left.status).toBe(405);
    expect(paths).toHaveLength(2);
  });
});
