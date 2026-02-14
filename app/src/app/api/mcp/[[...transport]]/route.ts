import { AsyncLocalStorage } from "node:async_hooks";
import { verifyToken as clerkVerifyToken } from "@clerk/backend";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { withMcpAuth } from "@vercel/mcp-adapter";
import { NextResponse } from "next/server";
import { trpcToMcpHandler } from "@/libs/mcp";
import { appRouter } from "@/server/api/root";
import { drizzleDB } from "@/server/db";

const mcpEnabled = process.env.NEXT_PUBLIC_MCP_ENABLED === "true";

// Rate limiter for MCP endpoint - stricter than general tRPC (30 req/60s vs 60 req/60s)
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  analytics: true,
  prefix: "mcp-ratelimit",
});

// Request-scoped storage for userId and request metadata to avoid race conditions
// Each request gets its own isolated context
type RequestContext = {
  userId: string | null;
  userIp: string;
  userAgent: string;
  scopes: string[];
};
const requestContext = new AsyncLocalStorage<RequestContext>();

const createMcpContext = async () => {
  // Get userId and request metadata from request-scoped storage (safe for concurrent requests)
  const ctx = requestContext.getStore();
  return {
    drizzle: drizzleDB,
    userIp: ctx?.userIp ?? "unknown",
    userId: ctx?.userId ?? null,
    userAgent: ctx?.userAgent ?? "mcp-client",
    abLemuReplacementVariant: undefined,
  };
};

/**
 * Derive the Clerk Frontend API URL from the publishable key.
 * The publishable key encodes the FAPI hostname in base64.
 */
const getClerkFapiUrl = (): string | null => {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    console.error("[MCP] No Clerk publishable key configured");
    return null;
  }

  const keyParts = publishableKey.split("_");
  if (keyParts.length < 3) {
    console.error("[MCP] Invalid publishable key format");
    return null;
  }

  const base64Part = keyParts.slice(2).join("_");
  let fapiHost = Buffer.from(base64Part, "base64").toString("utf-8");
  fapiHost = fapiHost.replace(/\$$/, "");
  return `https://${fapiHost}`;
};

// Cache the FAPI URL since it doesn't change
const clerkFapiUrl = getClerkFapiUrl();

/**
 * Verify token and return auth info.
 * Also updates the request-scoped context with the userId.
 */
const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;

  try {
    // Check if it's an opaque access token (oat_ prefix) vs JWT
    if (bearerToken.startsWith("oat_")) {
      if (!clerkFapiUrl) {
        return undefined;
      }

      // Call the OAuth userinfo endpoint
      const userInfoResponse = await fetch(`${clerkFapiUrl}/oauth/userinfo`, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      });

      if (!userInfoResponse.ok) {
        const errorText = await userInfoResponse.text();
        console.error(
          "[MCP] Opaque token userinfo failed:",
          userInfoResponse.status,
          errorText,
        );
        return undefined;
      }

      const userInfo = (await userInfoResponse.json()) as {
        user_id?: string;
        sub?: string;
        scope?: string;
      };

      const userId = userInfo.user_id ?? userInfo.sub ?? null;
      const tokenScopes = userInfo.scope ? userInfo.scope.split(" ") : [];
      // All authenticated users get write scope to perform game mutations
      const scopes = userId ? [...new Set([...tokenScopes, "write"])] : tokenScopes;

      // Update the request-scoped context with the verified userId and scopes
      const ctx = requestContext.getStore();
      if (ctx) {
        ctx.userId = userId;
        ctx.scopes = scopes;
      }

      return {
        token: bearerToken,
        clientId: "mcp-client",
        scopes,
        extra: { userId },
      };
    }

    // JWT token - verify directly
    const payload = await clerkVerifyToken(bearerToken, {
      secretKey: process.env.CLERK_SECRET_KEY,
      headerType: ["JWT", "at+jwt"],
    });

    const userId = payload.sub ?? null;

    // OAuth tokens may include a scope claim as a string or array
    const scopeClaim = (payload as { scope?: string | string[] }).scope;
    const tokenScopes = Array.isArray(scopeClaim)
      ? scopeClaim
      : typeof scopeClaim === "string"
        ? scopeClaim.split(" ")
        : [];
    // All authenticated users get write scope to perform game mutations
    const scopes = userId ? [...new Set([...tokenScopes, "write"])] : tokenScopes;

    // Update the request-scoped context with the verified userId and scopes
    const ctx = requestContext.getStore();
    if (ctx) {
      ctx.userId = userId;
      ctx.scopes = scopes;
    }

    return {
      token: bearerToken,
      clientId: payload.azp ?? "mcp-client",
      scopes,
      extra: { userId: payload.sub },
    };
  } catch (error) {
    console.error("[MCP] Token verification failed:", error);
    return undefined;
  }
};

const mcpHandler = trpcToMcpHandler(appRouter, createMcpContext, {
  config: {
    basePath: "/api",
    verboseLogs: process.env.NODE_ENV === "development",
  },
  serverOptions: {
    serverInfo: {
      name: "TheNinja-RPG MCP Server",
      version: "1.0.0",
    },
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
  },
  // Provide scopes from request-scoped context for authorization checks
  getScopes: () => requestContext.getStore()?.scopes ?? [],
});

const authenticatedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

// Extract IP from request headers
const getClientIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.headers.get("x-real-ip") ?? "unknown";
};

// Main handler that wraps requests with request-scoped context
const fixedHandler = async (req: Request) => {
  // Extract request metadata for context
  const userIp = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? "mcp-client";

  // Rate limit by IP before auth (prevents auth endpoint abuse)
  const { success } = await ratelimit.limit(`mcp-${userIp}`);
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Run the handler within request-scoped context
  // The verifyToken callback will populate ctx.userId and ctx.scopes when called
  return requestContext.run(
    { userId: null, userIp, userAgent, scopes: [] },
    async () => {
      return authenticatedHandler(req);
    },
  );
};

const notFoundResponse = () =>
  NextResponse.json({ error: "MCP not enabled" }, { status: 404 });

export const GET = mcpEnabled ? fixedHandler : notFoundResponse;
export const POST = mcpEnabled ? fixedHandler : notFoundResponse;
export const DELETE = mcpEnabled ? fixedHandler : notFoundResponse;
