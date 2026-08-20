import { describe, expect, it } from "vitest";
import {
  DEVICE_TOKEN_TTL_MS,
  hashConnectCode,
  pkceChallenge,
  signDeviceToken,
  verifierMatchesChallenge,
  verifyDeviceToken,
} from "@/libs/devContribution/deviceToken";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;

describe("device tokens", () => {
  it("round-trips a signed token", () => {
    const token = signDeviceToken(SECRET, "user_123", NOW, "jti-1");
    const result = verifyDeviceToken(SECRET, token, NOW + 1000);
    expect(result).toEqual({
      ok: true,
      userId: "user_123",
      jti: "jti-1",
      // iat is returned so the caller can compare it against the per-user
      // revocation epoch.
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + Math.floor(DEVICE_TOKEN_TTL_MS / 1000),
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signDeviceToken("other-secret", "user_123", NOW);
    expect(verifyDeviceToken(SECRET, token, NOW + 1000).ok).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = signDeviceToken(SECRET, "user_123", NOW);
    const [header, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        alg: "HS256",
        typ: "JWT",
        sub: "attacker",
        jti: "j",
        iat: Math.floor(NOW / 1000),
        exp: Math.floor((NOW + DEVICE_TOKEN_TTL_MS) / 1000),
        iss: "tnr-dev-client",
      }),
    ).toString("base64url");
    expect(verifyDeviceToken(SECRET, `${header}.${forged}.${sig}`, NOW + 1000).ok).toBe(
      false,
    );
  });

  it("rejects expired tokens", () => {
    const token = signDeviceToken(
      SECRET,
      "user_123",
      NOW - DEVICE_TOKEN_TTL_MS - 60_000,
    );
    expect(verifyDeviceToken(SECRET, token, NOW).ok).toBe(false);
  });

  it("rejects tokens issued in the future", () => {
    const token = signDeviceToken(SECRET, "user_123", NOW + 120_000);
    const result = verifyDeviceToken(SECRET, token, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token not valid yet");
  });

  it("rejects malformed tokens", () => {
    expect(verifyDeviceToken(SECRET, "not-a-token", NOW).ok).toBe(false);
    expect(verifyDeviceToken(SECRET, "a.b.c", NOW).ok).toBe(false);
    expect(verifyDeviceToken(SECRET, "", NOW).ok).toBe(false);
  });

  it("rejects a wrong algorithm header", () => {
    const token = signDeviceToken(SECRET, "user_123", NOW);
    const [_header, body, sig] = token.split(".");
    const noneHeader = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    expect(
      verifyDeviceToken(SECRET, `${noneHeader}.${body}.${sig}`, NOW + 1000).ok,
    ).toBe(false);
  });
});

describe("PKCE + connect codes", () => {
  it("derives a stable S256 challenge", () => {
    const challenge = pkceChallenge("test-verifier-0123456789");
    expect(challenge).toBe(pkceChallenge("test-verifier-0123456789"));
    expect(challenge).not.toBe(pkceChallenge("different-verifier"));
    expect(challenge).toHaveLength(43);
  });

  it("matches verifier against stored challenge", () => {
    const verifier = "a".repeat(64);
    const challenge = pkceChallenge(verifier);
    expect(verifierMatchesChallenge(verifier, challenge)).toBe(true);
    expect(verifierMatchesChallenge("b".repeat(64), challenge)).toBe(false);
  });

  it("hashes connect codes deterministically", () => {
    expect(hashConnectCode("code-1")).toBe(hashConnectCode("code-1"));
    expect(hashConnectCode("code-1")).not.toBe(hashConnectCode("code-2"));
  });
});
