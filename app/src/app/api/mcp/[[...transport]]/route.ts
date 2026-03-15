import { AsyncLocalStorage } from "node:async_hooks";
import { verifyToken as clerkVerifyToken } from "@clerk/backend";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import * as Sentry from "@sentry/nextjs";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { withMcpAuth } from "@vercel/mcp-adapter";
import { NextResponse } from "next/server";
import { trpcToModelContextProtocolHandler } from "@/libs/mcp";
import { appRouter } from "@/server/api/root";
import { drizzleDB } from "@/server/db";
import { isFetchOriginError } from "@/utils/error";
import { fetchWithTimeout } from "@/utils/http";
import { getClientIp } from "@/utils/network";

const mcpEnabled = process.env.NEXT_PUBLIC_MCP_ENABLED === "true";

// Timeout for OAuth userinfo endpoint (10s to prevent hanging requests while allowing for network latency)
const OAUTH_USERINFO_TIMEOUT_MS = 10000;

// Rate limiter for MCP endpoint - stricter than general tRPC (30 req/60s vs 60 req/60s)
// IP-based rate limiter (applied before auth to prevent auth endpoint abuse)
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  analytics: true,
  prefix: "mcp-ratelimit",
});

// Per-user rate limiter (applied after auth to prevent authenticated abuse)
const userRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  analytics: true,
  prefix: "mcp-user-ratelimit",
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
  const requestData = requestContext.getStore();
  return {
    drizzle: drizzleDB,
    userIp: requestData?.userIp ?? "unknown",
    userId: requestData?.userId ?? null,
    userAgent: requestData?.userAgent ?? "mcp-client",
    abLemuReplacementVariant: undefined,
  };
};

/**
 * Derive the Clerk Frontend API URL from the publishable key.
 *
 * Clerk publishable key format: pk_{environment}_{base64EncodedHostname}
 * Example: pk_test_c2VjcmV0LmNsZXJrLmFjY291bnRzLmRldiQ=
 *
 * Algorithm:
 * 1. Split the key by underscores to separate prefix, environment, and base64 hostname
 * 2. Extract the base64-encoded hostname (all parts after the environment)
 * 3. Decode from base64 to get the FAPI hostname (e.g., "secret.clerk.accounts.dev$")
 * 4. Remove trailing "$" character (Clerk's format marker)
 * 5. Prepend "https://" to create the full FAPI URL
 */
const getClerkFrontendApiUrl = (): string | null => {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    console.error("[MCP] No Clerk publishable key configured");
    return null;
  }

  // Step 1: Split by underscores (expected format: pk_environment_base64hostname)
  const publishableKeySegments = publishableKey.split("_");
  // Basic format validation - checks for minimum 3 segments (pk, environment, base64data)
  // Additional validation on the decoded domain is performed later to prevent malformed keys
  if (publishableKeySegments.length < 3) {
    console.error("[MCP] Invalid publishable key format");
    return null;
  }

  // Step 2: Extract base64-encoded hostname (everything after pk_environment_)
  const base64HostnameSegment = publishableKeySegments.slice(2).join("_");

  // Step 3: Decode base64 to get FAPI hostname
  const decodedHost = Buffer.from(base64HostnameSegment, "base64").toString("utf-8");

  // Validate decoded string length to prevent DoS attacks (255 is the RFC 1035 DNS hostname maximum)
  const MAX_HOSTNAME_LENGTH = 255;
  if (decodedHost.length > MAX_HOSTNAME_LENGTH) {
    console.error("[MCP] Decoded hostname exceeds maximum length");
    return null;
  }

  // Step 4: Remove Clerk's trailing "$" format marker
  const frontendApiHost = decodedHost.replace(/\$$/, "");

  // Step 5: Validate the host matches expected Clerk domain pattern
  // This prevents token leakage if the publishable key is manipulated
  // SECURITY: Properly anchor patterns and prevent consecutive dots
  const isValidClerkDomain =
    /^[a-z0-9-]+\.clerk\.accounts\.dev$/.test(frontendApiHost) || // Development: *.clerk.accounts.dev
    /^clerk\.[a-z0-9-]+\.lcl\.dev$/.test(frontendApiHost) || // Local development
    /^clerk\.[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/.test(frontendApiHost); // Production custom domains (no consecutive dots)

  if (!isValidClerkDomain) {
    console.error("[MCP] Invalid Clerk FAPI domain:", frontendApiHost);
    return null;
  }

  // Step 6: Construct full FAPI URL
  return `https://${frontendApiHost}`;
};

// Cache the FAPI URL since it doesn't change
const clerkFrontendApiUrl = getClerkFrontendApiUrl();

/**
 * Parse and normalize OAuth scopes from token claims.
 * Handles both string and array scope formats. Returns only the scopes as issued
 * without synthesizing additional scopes — authorization decisions (e.g. allowing
 * all authenticated users to mutate) are made explicitly in checkEndpointAuthorization.
 *
 * @param oauthScopeClaim - OAuth scope claim from token (string, array, or undefined)
 * @returns Normalized array of unique scopes
 */
const parseAndNormalizeScopes = (
  oauthScopeClaim: string | string[] | undefined,
): string[] => {
  const tokenScopes = Array.isArray(oauthScopeClaim)
    ? oauthScopeClaim
    : typeof oauthScopeClaim === "string"
      ? oauthScopeClaim.split(" ")
      : [];
  // SECURITY: Normalize all scopes to lowercase and trim whitespace to prevent authorization bypass
  return [...new Set(tokenScopes.map((s) => s.trim().toLowerCase()))];
};

/**
 * Update request context with verified user information.
 */
const updateRequestContext = (userId: string | null, scopes: string[]): void => {
  const requestData = requestContext.getStore();
  if (requestData) {
    requestData.userId = userId;
    requestData.scopes = scopes;
  }
};

/**
 * Verify opaque access token via OAuth userinfo endpoint.
 */
const verifyOpaqueToken = async (
  bearerToken: string,
): Promise<AuthInfo | undefined> => {
  if (!clerkFrontendApiUrl) {
    return undefined;
  }

  // Call the OAuth userinfo endpoint with timeout to prevent hanging requests
  const userInfoResponse = await fetchWithTimeout(
    `${clerkFrontendApiUrl}/oauth/userinfo`,
    {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
    OAUTH_USERINFO_TIMEOUT_MS,
  );

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
  const scopes = parseAndNormalizeScopes(userInfo.scope);

  updateRequestContext(userId, scopes);

  return {
    token: bearerToken,
    clientId: "mcp-client",
    scopes,
    extra: { userId },
  };
};

/**
 * Verify JWT token using Clerk verification.
 */
const verifyJwtToken = async (bearerToken: string): Promise<AuthInfo | undefined> => {
  const payload = await clerkVerifyToken(bearerToken, {
    secretKey: process.env.CLERK_SECRET_KEY,
    headerType: ["JWT", "at+jwt"],
  });

  const userId = payload.sub ?? null;

  // OAuth tokens may include a scope claim as a string or array
  const scopeClaim = (payload as { scope?: string | string[] }).scope;
  const scopes = parseAndNormalizeScopes(scopeClaim);

  updateRequestContext(userId, scopes);

  return {
    token: bearerToken,
    clientId: payload.azp ?? "mcp-client",
    scopes,
    extra: { userId: payload.sub },
  };
};

/**
 * Handle token verification errors with proper filtering and logging.
 */
const handleTokenVerificationError = (error: unknown): undefined => {
  if (error instanceof Error) {
    const stack = error.stack || "";
    const errorMessage = error.message || "";

    // First verify origin to prevent spoofing - check stack trace BEFORE error names
    const isClerkError =
      stack.includes("@clerk/") ||
      stack.includes("clerk-sdk-node") ||
      stack.includes("/clerk/");
    const isFetchAbortError = error.name === "AbortError" && isFetchOriginError(error);

    // Additional validation: Check error message contains Clerk-specific patterns
    // Require explicit Clerk references to avoid false matches with other JWT libraries
    const hasClerkReference =
      errorMessage.includes("Clerk") || errorMessage.includes("clerk.com");
    const hasClerkJWKPattern = errorMessage.includes("JWK") && hasClerkReference;
    const hasClerkJWTPattern =
      /JWT (expired|invalid|malformed)/i.test(errorMessage) && hasClerkReference;
    const hasClerkSessionPattern =
      /session.+token/i.test(errorMessage) && hasClerkReference;

    const hasClerkContent =
      hasClerkReference ||
      hasClerkJWKPattern ||
      hasClerkJWTPattern ||
      hasClerkSessionPattern;

    // Only check error types if from expected sources AND contains expected content
    if (isClerkError && hasClerkContent) {
      if (
        error.name === "JWTExpired" ||
        error.name === "JWTInvalid" ||
        error.name === "ClerkAPIResponseError"
      ) {
        console.error("[MCP] Token verification failed:", error);
        return undefined;
      }
    }

    if (isFetchAbortError) {
      console.error("[MCP] Token verification failed:", error);
      return undefined;
    }

    // For any other errors, even if they contain token-related messages,
    // capture to Sentry to ensure no unexpected errors are masked.
    // This helps identify if Clerk throws new error types we should handle.
    console.error("[MCP] Unexpected token verification error:", error);
    Sentry.captureException(error, {
      tags: { source: "mcp-token-verification" },
    });
    return undefined;
  }

  // Non-Error objects
  console.error("[MCP] Unexpected non-Error thrown during token verification:", error);
  Sentry.captureException(error, {
    tags: { source: "mcp-token-verification" },
  });
  return undefined;
};

/**
 * Verify token and return auth info.
 * Also updates the request-scoped context with the userId.
 */
const verifyToken = async (
  _serverRequest: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;

  try {
    // Check if it's an opaque access token (oat_ prefix) vs JWT
    if (bearerToken.startsWith("oat_")) {
      return await verifyOpaqueToken(bearerToken);
    }

    // JWT token - verify directly
    return await verifyJwtToken(bearerToken);
  } catch (error) {
    return handleTokenVerificationError(error);
  }
};

const mcpHandler = trpcToModelContextProtocolHandler(appRouter, createMcpContext, {
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
  // Explicit authenticated check — decoupled from scope enforcement
  getIsAuthenticated: () => !!requestContext.getStore()?.userId,
});

// Wrapper around mcpHandler to add per-user rate limiting after auth
const mcpHandlerWithUserRateLimit = async (request: Request) => {
  // At this point, verifyToken has already been called by withMcpAuth
  // and userId is populated in the request context
  const requestData = requestContext.getStore();

  // Apply per-user rate limiting for authenticated requests
  if (requestData?.userId) {
    const { success: userLimitSuccess } = await userRatelimit.limit(
      `mcp-user-${requestData.userId}`,
    );
    if (!userLimitSuccess) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  }

  // Proceed to the actual MCP handler
  return mcpHandler(request);
};

const authenticatedHandler = withMcpAuth(mcpHandlerWithUserRateLimit, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
  // Explicitly set resourceUrl in development to avoid localhost vs 127.0.0.1 mismatch
  resourceUrl:
    process.env.NODE_ENV === "development" ? "http://localhost:3000" : undefined,
});

// Main handler that wraps requests with request-scoped context
const mcpRequestHandlerWithContext = async (req: Request) => {
  // Extract request metadata for context
  const userIp = getClientIp(req.headers);
  const userAgent = req.headers.get("user-agent") ?? "mcp-client";

  // Rate limit by IP before auth (prevents auth endpoint abuse)
  const { success } = await ratelimit.limit(`mcp-${userIp}`);
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Run the handler within request-scoped context
  // The verifyToken callback will populate requestData.userId and requestData.scopes when called
  return requestContext.run(
    { userId: null, userIp, userAgent, scopes: [] },
    async () => {
      return authenticatedHandler(req);
    },
  );
};

const notFoundResponse = () =>
  NextResponse.json({ error: "MCP not enabled" }, { status: 404 });

export const GET = mcpEnabled ? mcpRequestHandlerWithContext : notFoundResponse;
export const POST = mcpEnabled ? mcpRequestHandlerWithContext : notFoundResponse;
export const DELETE = mcpEnabled ? mcpRequestHandlerWithContext : notFoundResponse;
