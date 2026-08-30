import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64url, normalisePrivateKey, signJwt } from "@/server/utils/push/jwt";

const decodeSegment = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

describe("signJwt", () => {
  it("signs an APNs provider token that Apple's curve can verify", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const jwt = signJwt({
      algorithm: "ES256",
      header: { kid: "ABC123DEFG" },
      claims: { iss: "TEAMID1234", iat: 1_700_000_000 },
      privateKey,
    });

    const [header, claims, signature] = jwt.split(".");
    expect(decodeSegment(header ?? "")).toEqual({
      kid: "ABC123DEFG",
      alg: "ES256",
      typ: "JWT",
    });
    expect(decodeSegment(claims ?? "")).toEqual({
      iss: "TEAMID1234",
      iat: 1_700_000_000,
    });

    // APNs rejects DER-encoded ECDSA signatures, so this must be the raw 64-byte r||s
    // pair. Verifying with ieee-p1363 is what proves the encoding is right.
    const raw = Buffer.from(signature ?? "", "base64url");
    expect(raw.length).toBe(64);
    expect(
      cryptoVerify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        raw,
      ),
    ).toBe(true);
  });

  it("signs an RS256 service-account assertion", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const jwt = signJwt({
      algorithm: "RS256",
      claims: { iss: "svc@project.iam.gserviceaccount.com", exp: 1_700_003_600 },
      privateKey,
    });

    const [header, claims, signature] = jwt.split(".");
    expect(decodeSegment(header ?? "")).toEqual({ alg: "RS256", typ: "JWT" });
    expect(
      cryptoVerify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("accepts a key whose newlines arrived escaped from a secret store", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const escaped = privateKey.replace(/\n/g, "\\n");

    expect(normalisePrivateKey(escaped)).toBe(privateKey);
    expect(() =>
      signJwt({ algorithm: "ES256", claims: { iat: 1 }, privateKey: escaped }),
    ).not.toThrow();
  });

  it("emits url-safe base64 with no padding", () => {
    expect(base64url("???")).toBe("Pz8_");
    expect(base64url(Buffer.from([251, 255]))).toBe("-_8");
  });
});
