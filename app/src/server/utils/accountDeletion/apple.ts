import { clerkClient } from "@clerk/nextjs/server";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
export const isAppleProvider = (provider: string) =>
  provider === "apple" || provider === "oauth_apple";

export const appleClientCredentials = async () => {
  const clientId = process.env.APPLE_SIGN_IN_CLIENT_ID;
  const teamId = process.env.APPLE_SIGN_IN_TEAM_ID;
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID;
  const privateKey = process.env.APPLE_SIGN_IN_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !privateKey)
    throw new Error("Apple account deletion is temporarily unavailable.");
  const key = await importPKCS8(privateKey.replace(/\\n/g, "\n"), "ES256");
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
  return { client_id: clientId, client_secret: secret };
};

export const revokeAppleToken = async (
  token: string,
  type: "access_token" | "refresh_token",
  credentials: Awaited<ReturnType<typeof appleClientCredentials>>,
) => {
  const response = await fetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...credentials, token, token_type_hint: type }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error("Apple authorization revocation failed. Please try again.");
};

/** Exchange the native sheet's single-use code and bind its signed subject to Clerk. */
export const prepareAppleDeletion = async (
  userId: string,
  code?: string,
): Promise<string | null> => {
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const accounts = user.externalAccounts.filter((account) =>
    isAppleProvider(account.provider),
  );
  if (!accounts.length) return null;
  const credentials = await appleClientCredentials();
  if (!code) {
    // Android or older shells may have a server-managed OAuth token in Clerk.
    const tokens = await clerk.users.getUserOauthAccessToken(userId, "apple");
    if (!tokens.data.length)
      throw new Error(
        "Please use the latest iPhone app and verify with Apple to delete this Apple-linked account.",
      );
    for (const token of tokens.data)
      await revokeAppleToken(token.token, "access_token", credentials);
    return accounts.length === 1 ? (accounts[0]?.providerUserId ?? null) : null;
  }
  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...credentials,
      code,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      "Apple verification expired. Please try again and approve the Apple sign-in sheet.",
    );
  const tokens = (await response.json()) as {
    id_token?: string;
    refresh_token?: string;
  };
  if (!tokens.id_token || !tokens.refresh_token)
    throw new Error("Apple returned incomplete verification. Please try again.");
  const { payload } = await jwtVerify(tokens.id_token, appleKeys, {
    issuer: "https://appleid.apple.com",
    audience: credentials.client_id,
  });
  if (
    !payload.sub ||
    !accounts.some((account) => account.providerUserId === payload.sub)
  )
    throw new Error("Verify with the Apple account linked to this game account.");
  await revokeAppleToken(tokens.refresh_token, "refresh_token", credentials);
  return payload.sub;
};
