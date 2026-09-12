import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  tokens: vi.fn(),
  verify: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getUser: mocks.user, getUserOauthAccessToken: mocks.tokens },
  }),
}));
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { privateKey } = await actual.generateKeyPair("ES256");
  return {
    ...actual,
    createRemoteJWKSet: () => ({}),
    importPKCS8: async () => privateKey,
    jwtVerify: mocks.verify,
  };
});

import { prepareAppleDeletion } from "../apple";

describe("Apple deletion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    for (const name of [
      "APPLE_SIGN_IN_CLIENT_ID",
      "APPLE_SIGN_IN_TEAM_ID",
      "APPLE_SIGN_IN_KEY_ID",
      "APPLE_SIGN_IN_PRIVATE_KEY",
    ])
      vi.stubEnv(name, "test");
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
    expect(await prepareAppleDeletion("user_test")).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("never revokes a different Apple account", async () => {
    mocks.verify.mockResolvedValue({ payload: { sub: "someone_else" } });
    await expect(prepareAppleDeletion("user_test", "code")).rejects.toThrow("linked");
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
    expect(await prepareAppleDeletion("user_test", "code")).toBe("apple_owner");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [url, options] = mocks.fetch.mock.calls[1] ?? [];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    expect(options.body.get("token")).toBe("refresh-token");
    expect(options.body.get("token_type_hint")).toBe("refresh_token");
  });
  it("does not skip revocation when a stored token is unavailable", async () => {
    mocks.tokens.mockResolvedValue({ data: [] });
    await expect(prepareAppleDeletion("user_test")).rejects.toThrow("latest iPhone");
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
});
