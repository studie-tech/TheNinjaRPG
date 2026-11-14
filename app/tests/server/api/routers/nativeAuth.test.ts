import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { nativeAuthRouter } from "@/server/api/routers/nativeAuth";
import { createTRPCRouter } from "@/server/api/trpc";
import { drizzleDB } from "@/server/db";
import * as storeModule from "@/server/utils/nativeAuth";
import { stubRateLimitTransport } from "../../../setup/rateLimit";

const flowId = "f".repeat(43);
const proof = "p".repeat(43);
const code = "c".repeat(43);
const expired = "Sign-in expired or was already used. Return to the app and try again.";
const mocks = {
  start: vi.fn(),
  describe: vi.fn(),
  approve: vi.fn(),
  redeem: vi.fn(),
  ticket: vi.fn(),
};
let limitSuccess = true;
const router = createTRPCRouter({ nativeAuth: nativeAuthRouter });
const caller = (userId: string | null = null) =>
  router.createCaller({
    drizzle: drizzleDB,
    userId,
    userIp: "127.0.0.1",
    userAgent: "test",
    userCountry: undefined,
    abLemuReplacementVariant: undefined,
    wallpaperVariant: undefined,
  }).nativeAuth;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockResolvedValue(flowId);
  mocks.describe.mockResolvedValue({ provider: "google" });
  mocks.approve.mockResolvedValue(code);
  mocks.redeem.mockResolvedValue("user-approved");
  mocks.ticket.mockResolvedValue({ token: "short-lived-ticket" });
  limitSuccess = true;
  // The limiter's method is an instance field; mock its transport rather than a
  // prototype so this suite never contacts the configured Redis service.
  stubRateLimitTransport({
    remaining: () => (limitSuccess ? 59 : -1),
    unexpectedRequestMessage: "Unexpected HTTP request in native auth tests",
  });
  vi.spyOn(storeModule, "nativeAuthStore").mockReturnValue(mocks);
  vi.spyOn(clerk, "clerkClient").mockResolvedValue({
    signInTokens: { createSignInToken: mocks.ticket },
  } as unknown as Awaited<ReturnType<typeof clerk.clerkClient>>);
});
afterEach(() => vi.restoreAllMocks());

describe("native auth session issuance", () => {
  it("allows a signed-out shell to start but never approve an identity", async () => {
    expect(await caller().start({ provider: "google", challenge: proof })).toEqual({
      flowId,
    });
    await expect(caller().approve({ flowId })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.ticket).not.toHaveBeenCalled();
  });
  it("binds approval to the authenticated browser identity, never caller input", async () => {
    expect(await caller("user-browser").approve({ flowId })).toEqual({
      success: true,
      message: "Sign-in approved",
      callbackUrl: `tnr://oauth-callback?flow=${flowId}&code=${code}`,
    });
    expect(mocks.approve).toHaveBeenCalledWith(flowId, "user-browser");
    await expect(
      caller("user-browser").approve({ flowId, userId: "user-other" } as {
        flowId: string;
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.approve).toHaveBeenCalledTimes(1);
  });
  it("issues a short-lived ticket only for the identity returned by atomic redemption", async () => {
    expect(await caller().exchange({ flowId, verifier: proof, code })).toEqual({
      success: true,
      message: "Sign-in ready",
      ticket: "short-lived-ticket",
    });
    expect(mocks.redeem).toHaveBeenCalledWith(flowId, proof, code);
    expect(mocks.ticket).toHaveBeenCalledWith({
      userId: "user-approved",
      expiresInSeconds: 60,
    });
  });
  it("does not call Clerk for an expired, invalid or replayed proof", async () => {
    mocks.redeem.mockResolvedValue(null);
    expect(await caller().exchange({ flowId, verifier: proof, code })).toEqual({
      success: false,
      message: expired,
    });
    expect(mocks.ticket).not.toHaveBeenCalled();
  });
  it("answers an expired or used approval without a callback", async () => {
    mocks.approve.mockResolvedValue(null);
    expect(await caller("user-browser").approve({ flowId })).toEqual({
      success: false,
      message: expired,
    });
  });
  it("rejects describing an expired flow", async () => {
    mocks.describe.mockResolvedValue(null);
    await expect(caller().describe({ flowId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expired,
    });
  });
  it("rate-limits authentication without charging a character or issuing a ticket", async () => {
    limitSuccess = false;
    await expect(caller("user-browser").approve({ flowId })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Too many sign-in attempts. Please wait a minute and try again.",
    });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.ticket).not.toHaveBeenCalled();
  });
});
