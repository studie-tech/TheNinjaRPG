import { expect, test } from "bun:test";
import {
  base64UrlEncode,
  buildConnectUrl,
  generatePkce,
  generateState,
  sha256Base64Url,
} from "../oauth";

test("sha256Base64Url matches the RFC 7636 test vector", () => {
  expect(sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("base64UrlEncode produces url-safe characters without padding", () => {
  const encoded = base64UrlEncode(Buffer.from([0xfb, 0xff, 0xfe, 0x00, 0x01]));
  expect(encoded).not.toMatch(/[+/=]/);
});

test("generatePkce returns 43-char url-safe verifier and challenge", () => {
  const { verifier, challenge } = generatePkce();
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("challenge is the S256 transform of the verifier", () => {
  const { verifier, challenge } = generatePkce();
  expect(challenge).toBe(sha256Base64Url(verifier));
});

test("state satisfies the /dev-connect page pattern", () => {
  expect(generateState()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
});

test("buildConnectUrl encodes all parameters and strips trailing slashes", () => {
  const { challenge } = generatePkce();
  const state = generateState();
  const url = new URL(
    buildConnectUrl({
      apiBase: "https://example.com/",
      state,
      codeChallenge: challenge,
      loopbackPort: 49200,
    }),
  );
  expect(url.origin + url.pathname).toBe("https://example.com/dev-connect");
  expect(url.searchParams.get("state")).toBe(state);
  expect(url.searchParams.get("code_challenge")).toBe(challenge);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("loopback_port")).toBe("49200");
});
