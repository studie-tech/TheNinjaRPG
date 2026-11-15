import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { POST } from "@/app/api/mcp/[[...transport]]/route";
import { env } from "@/env/server.mjs";

// Clerk instance keys for the test. With a PEM jwtKey, Clerk verifies JWTs locally (no JWKS fetch).
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWT_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
const PUBLISHABLE_KEY = `pk_test_${Buffer.from("tnr-test.clerk.accounts.dev$").toString("base64")}`;
const SESSION_TOKEN_CATEGORY = "cl_B7d4PD111AAA";

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Sign an RS256 JWT with the test instance key, as Clerk would. */
const signJwt = (header: Record<string, unknown>, claims: Record<string, unknown>) => {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: "RS256", kid: "ins_test", ...header })}.${base64url(
    {
      iat: now - 5,
      nbf: now - 5,
      exp: now + 300,
      ...claims,
    },
  )}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString(
    "base64url",
  );
  return `${unsigned}.${signature}`;
};

/** An OAuth access token as Clerk issues it to MCP clients (no `cat` header). */
const oauthAccessToken = (claims: Record<string, unknown> = {}) =>
  signJwt(
    { typ: "at+jwt" },
    {
      iss: "https://tnr-test.clerk.accounts.dev",
      sub: "user_oauth",
      client_id: "client_mcp",
      jti: "oat_jti",
      scope: "profile email",
      ...claims,
    },
  );

const sessionToken = () =>
  signJwt(
    { typ: "JWT", cat: SESSION_TOKEN_CATEGORY },
    {
      iss: "https://tnr-test.clerk.accounts.dev",
      sub: "user_session",
      sid: "sess_test",
      azp: "http://localhost:3000",
      v: 2,
    },
  );

const toolsListRequest = (bearerToken: string) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

const savedEnv = {
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  jwtKey: env.CLERK_JWT_KEY,
};

beforeAll(() => {
  process.env.CLERK_SECRET_KEY = "sk_test_mcp_route";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
  env.CLERK_JWT_KEY = JWT_KEY;
});

afterAll(() => {
  process.env.CLERK_SECRET_KEY = savedEnv.secretKey;
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedEnv.publishableKey;
  env.CLERK_JWT_KEY = savedEnv.jwtKey;
  if (savedEnv.secretKey === undefined) delete process.env.CLERK_SECRET_KEY;
  if (savedEnv.publishableKey === undefined) {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }
});

/** Answer the IP rate limiter's Upstash commands with an allowance; reject anything else. */
const stubUpstash = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(process.env.UPSTASH_REDIS_REST_URL ?? "")) {
      throw new Error(`Unexpected external request: ${url}`);
    }
    const commands = JSON.parse(String(init?.body)) as unknown[];
    const resultFor = (command: unknown[]) => ({
      result: command[0] === "evalsha" || command[0] === "eval" ? [29, 30] : 1,
    });
    return Response.json(
      Array.isArray(commands[0])
        ? commands.map((command) => resultFor(command as unknown[]))
        : resultFor(commands),
    );
  });

beforeEach(() => {
  stubUpstash();
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(Sentry, "captureMessage").mockReturnValue("test-event");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("answers an invalid bearer token with 401 without reporting it", async () => {
  const response = await POST(toolsListRequest("not-a-jwt"));
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeTruthy();
  expect(Sentry.captureException).not.toHaveBeenCalled();
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
});

it("accepts a Clerk OAuth access token (at+jwt) from an MCP client", async () => {
  const response = await POST(toolsListRequest(oauthAccessToken()));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"tools"');
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it("still accepts a Clerk session token", async () => {
  const response = await POST(toolsListRequest(sessionToken()));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"tools"');
});

it("answers an OAuth access token signed by another key with 401 without reporting it", async () => {
  const forged = oauthAccessToken();
  const [header, payload] = forged.split(".");
  const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), otherKey);
  const response = await POST(
    toolsListRequest(`${header}.${payload}.${signature.toString("base64url")}`),
  );
  expect(response.status).toBe(401);
  expect(Sentry.captureException).not.toHaveBeenCalled();
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
});

it("answers an expired OAuth access token with 401", async () => {
  const now = Math.floor(Date.now() / 1000);
  const response = await POST(
    toolsListRequest(
      oauthAccessToken({ iat: now - 600, nbf: now - 600, exp: now - 300 }),
    ),
  );
  expect(response.status).toBe(401);
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
});
