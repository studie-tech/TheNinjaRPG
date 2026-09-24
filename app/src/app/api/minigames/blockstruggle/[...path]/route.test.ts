// @vitest-environment node
import { randomBytes } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn() }));
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockOidc = getVercelOidcToken as unknown as ReturnType<typeof vi.fn>;

const route = "https://rpg.example/api/minigames/blockstruggle/session";
const context = { params: Promise.resolve({ path: ["session"] }) };
const environmentNames = [
  "BLOCKSTRUGGLE_API_ORIGIN",
  "BLOCKSTRUGGLE_RPG_ORIGIN",
  "BLOCKSTRUGGLE_BRIDGE_COOKIE_KEY",
  "BLOCKSTRUGGLE_CLERK_JWT_TEMPLATE",
  "BLOCKSTRUGGLE_TRUSTED_VERCEL_SOURCE",
] as const;
const originalEnvironment = environmentNames.map((name) => process.env[name]);
const originalFetch = globalThis.fetch;
const request = (cookie?: string) =>
  new NextRequest(route, {
    headers: {
      Origin: "https://rpg.example",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

describe("Block Struggle Next.js route boundary", () => {
  beforeEach(() => {
    process.env.BLOCKSTRUGGLE_API_ORIGIN = "https://puzzle.example";
    process.env.BLOCKSTRUGGLE_RPG_ORIGIN = "https://rpg.example";
    process.env.BLOCKSTRUGGLE_BRIDGE_COOKIE_KEY = randomBytes(32).toString("base64url");
    process.env.BLOCKSTRUGGLE_CLERK_JWT_TEMPLATE = "blockstruggle_ninja";
  });

  afterEach(() => {
    environmentNames.forEach((name, index) => {
      const value = originalEnvironment[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("keeps the puzzle bearer secret while rechecking Clerk for every request", async () => {
    const getToken = vi.fn(async () => "clerk.proof");
    mockAuth.mockResolvedValue({
      userId: "rpg-user",
      sessionId: "rpg-session",
      getToken,
    } as unknown as Awaited<ReturnType<typeof auth>>);
    let exchanges = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith("/exchange")) {
        exchanges++;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer clerk.proof",
        );
        return Response.json({
          token: "a".repeat(43),
          playerId: "p_player",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${"a".repeat(43)}`,
      );
      return Response.json({ playerId: "p_player" });
    };

    const first = await GET(request(), context);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(first.status).toBe(200);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).not.toContain("a".repeat(43));
    expect(await first.text()).toBe('{"playerId":"p_player"}');

    const second = await GET(request(setCookie.split(";")[0]), context);
    expect(second.status).toBe(200);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(auth).toHaveBeenCalledTimes(2);
    expect(exchanges).toBe(1);
    expect(getToken).toHaveBeenCalledWith({ template: "blockstruggle_ninja" });
    expect(mockOidc).not.toHaveBeenCalled();

    mockAuth.mockResolvedValue({
      userId: null,
      sessionId: null,
    } as unknown as Awaited<ReturnType<typeof auth>>);
    const signedOut = await GET(request(setCookie.split(";")[0]), context);
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(exchanges).toBe(1);
  });

  it("keeps the bridge disabled until a scoped Clerk JWT template is configured", async () => {
    process.env.BLOCKSTRUGGLE_CLERK_JWT_TEMPLATE = "";
    const getToken = vi.fn(async () => "standard.session.token");
    mockAuth.mockResolvedValue({
      userId: "rpg-user",
      sessionId: "rpg-session",
      getToken,
    } as unknown as Awaited<ReturnType<typeof auth>>);
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("retains the encrypted cookie when upstream logout fails so it can be retried", async () => {
    mockAuth.mockResolvedValue({
      userId: "rpg-user",
      sessionId: "rpg-session",
      getToken: async () => "clerk.proof",
    } as unknown as Awaited<ReturnType<typeof auth>>);
    let revokeSucceeds = false;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/exchange"))
        return Response.json({
          token: "a".repeat(43),
          playerId: "p_player",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      if (init?.method === "DELETE")
        return revokeSucceeds
          ? new Response(null, { status: 204 })
          : Response.json({ error: "Unavailable" }, { status: 503 });
      return Response.json({ playerId: "p_player" });
    };
    const signedIn = await GET(request(), context);
    const cookie = signedIn.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toBeTruthy();
    const logoutRequest = () =>
      new NextRequest(route, {
        method: "DELETE",
        headers: { Origin: "https://rpg.example", Cookie: cookie },
      });
    const failed = await DELETE(logoutRequest(), context);
    expect(failed.status).toBe(502);
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect((await GET(request(cookie), context)).status).toBe(200);
    revokeSucceeds = true;
    const retried = await DELETE(logoutRequest(), context);
    expect(retried.status).toBe(204);
    expect(retried.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears the bridge cookie only after successful account-link redemption", async () => {
    mockAuth.mockResolvedValue({
      userId: "rpg-user",
      sessionId: "rpg-session",
      getToken: async () => "clerk.proof",
    } as unknown as Awaited<ReturnType<typeof auth>>);
    let status = 409;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/api/ninja/identity-link/redeem");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer clerk.proof",
      );
      return Response.json(
        status === 200 ? { playerId: "p_block" } : { error: "Conflict" },
        { status },
      );
    };
    const linkRequest = () =>
      new NextRequest(
        "https://rpg.example/api/minigames/blockstruggle/identity-link/redeem",
        {
          method: "POST",
          headers: {
            Origin: "https://rpg.example",
            "Content-Type": "application/json",
            Cookie: "tnr-blockstruggle-session=old",
          },
          body: JSON.stringify({ code: "c".repeat(43) }),
        },
      );
    const linkContext = {
      params: Promise.resolve({ path: ["identity-link", "redeem"] }),
    };
    const conflict = await POST(linkRequest(), linkContext);
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("set-cookie")).toBeNull();
    status = 200;
    const linked = await POST(linkRequest(), linkContext);
    expect(linked.status).toBe(200);
    expect(linked.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("forwards a Vercel OIDC token only to the protected game preview", async () => {
    process.env.BLOCKSTRUGGLE_API_ORIGIN =
      "https://blockstruggle-git-codex-rebuild-the-ninja-rpg.vercel.app";
    process.env.BLOCKSTRUGGLE_TRUSTED_VERCEL_SOURCE = "true";
    mockOidc.mockResolvedValue("header.payload.signature");
    mockAuth.mockResolvedValue({
      userId: "rpg-user",
      sessionId: "rpg-session",
      getToken: async () => "clerk.proof",
    } as unknown as Awaited<ReturnType<typeof auth>>);
    let calls = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(input)).toMatch(
        /^https:\/\/blockstruggle-git-codex-rebuild-the-ninja-rpg\.vercel\.app\//,
      );
      expect(new Headers(init?.headers).get("x-vercel-trusted-oidc-idp-token")).toBe(
        "header.payload.signature",
      );
      return new URL(String(input)).pathname.endsWith("/exchange")
        ? Response.json({
            token: "a".repeat(43),
            playerId: "p_player",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          })
        : Response.json({ playerId: "p_player" });
    };
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(mockOidc).toHaveBeenCalledTimes(1);
    expect(response.headers.has("x-vercel-trusted-oidc-idp-token")).toBe(false);
  });
});
