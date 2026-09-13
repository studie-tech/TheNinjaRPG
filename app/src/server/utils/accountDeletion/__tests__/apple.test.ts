import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as clerk from "@clerk/nextjs/server";
import * as jose from "jose";
import { prepareAppleDeletion } from "../apple";

const originalEnv = { ...process.env };

const mocks = { user: vi.fn(), tokens: vi.fn(), verify: vi.fn(), fetch: vi.fn() };
const { privateKey } = await jose.generateKeyPair("ES256");
afterEach(() => {
  vi.restoreAllMocks();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});


describe("Apple deletion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(clerk, "clerkClient").mockResolvedValue({
      users: { getUser: mocks.user, getUserOauthAccessToken: mocks.tokens },
    } as unknown as Awaited<ReturnType<typeof clerk.clerkClient>>);
    vi.spyOn(jose, "jwtVerify").mockImplementation(mocks.verify);
    vi.spyOn(jose, "importPKCS8").mockResolvedValue(privateKey);
    vi.spyOn(globalThis, "fetch").mockImplementation(mocks.fetch);
    for (const name of [
      "APPLE_SIGN_IN_CLIENT_ID",
      "APPLE_SIGN_IN_TEAM_ID",
      "APPLE_SIGN_IN_KEY_ID",
      "APPLE_SIGN_IN_PRIVATE_KEY",
    ])
      process.env[name] = "test";
    mocks.user.mockResolvedValue({
      externalAccounts: [{ provider: "apple", providerUserId: "apple_owner" }],
    });
    mocks.verify.mockResolvedValue({ payload: { sub: "apple_owner" } });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: "id-token", refresh_token: "refresh-token" }),
    });
  });
  it("does not require Apple credentials for other login providers", async () => {
    mocks.user.mockResolvedValue({ externalAccounts: [{ provider: "google" }] });
    expect(await prepareAppleDeletion("user_test")).toEqual({ subject: null });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("never revokes a different Apple account", async () => {
    mocks.verify.mockResolvedValue({ payload: { sub: "someone_else" } });
    expect(await prepareAppleDeletion("user_test", "code")).toEqual({
      error: "Verify with the Apple account linked to this game account.",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("requires a valid signed Apple identity token", async () => {
    mocks.verify.mockRejectedValue(new Error("invalid signature"));
    await expect(prepareAppleDeletion("user_test", "code")).rejects.toThrow(
      "signature",
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("exchanges the code and revokes the refresh token for the verified owner", async () => {
    expect(await prepareAppleDeletion("user_test", "code")).toEqual({
      subject: "apple_owner",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [url, options] = mocks.fetch.mock.calls[1] ?? [];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    expect(options.body.get("token")).toBe("refresh-token");
    expect(options.body.get("token_type_hint")).toBe("refresh_token");
  });
  it("does not skip revocation when a stored token is unavailable", async () => {
    mocks.tokens.mockResolvedValue({ data: [] });
    expect(await prepareAppleDeletion("user_test")).toEqual({
      error:
        "Please use the latest iPhone app and verify with Apple to delete this Apple-linked account.",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not accept failed revocation", async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id_token: "id-token", refresh_token: "refresh-token" }),
      })
      .mockResolvedValueOnce({ ok: false });
    await expect(prepareAppleDeletion("user_test", "code")).rejects.toThrow(
      "revocation failed",
    );
  });
  it("returns recovery instructions for an expired code", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });
    expect(await prepareAppleDeletion("user_test", "expired")).toEqual({
      error:
        "Apple verification expired. Please try again and approve the Apple sign-in sheet.",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps unexpected provider errors out of the recovery response", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "server_error" }),
    });
    await expect(prepareAppleDeletion("user_test", "code")).rejects.toThrow(
      "Apple verification failed",
    );
  });
});
