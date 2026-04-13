/**
 * Provisions ephemeral Clerk + DB users for the TNR reviewer agent.
 *
 * Each call creates (or updates) one Clerk user per profile, syncs a matching
 * row in the `userData` table, and returns credentials + a one-time Clerk
 * sign-in token the agent can use for passwordless browser login.
 *
 * User identity is keyed on a deterministic `external_id` derived from the
 * run ID and profile key, so repeated runs reuse/reset the same accounts.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { UserRanks } from "@/drizzle/constants";
import { userData, village } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { drizzleDB } from "@/server/db";
import type { AiTestUserProfile } from "@/validators/ai-test-user";

/** Shape returned per user after successful provisioning. */
type ProvisionedAiTestUser = {
  key: string;
  userId: string;
  username: string;
  email: string;
  password: string;
  level: number;
  rank: (typeof UserRanks)[number];
  villageId: string;
  villageName: string;
  isBanned: boolean;
  signInToken?: string;
};

// Standard Clerk Backend API base — not instance-specific
const CLERK_API_ENDPOINT = "https://api.clerk.com/v1";

/** Build auth headers for Clerk Backend API calls. */
const buildMachineHeaders = () => {
  if (!env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required for AI test-user provisioning");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
  };
};

// Clerk API calls should never hang the provisioning flow
const CLERK_TIMEOUT_MS = 15_000;

/** Thin wrapper around `fetch` for the Clerk Backend API with auth + timeout. */
const fetchClerkApi = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${CLERK_API_ENDPOINT}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(CLERK_TIMEOUT_MS),
    headers: {
      ...buildMachineHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Clerk API ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
};

/** Normalise a freeform key into a safe, lowercase identifier. */
const sanitizeKey = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

/** Satisfies Clerk's password policy: uppercase + lowercase + digit + special. */
const createPassword = () => `Tnr!${randomBytes(10).toString("hex")}1A`;

/** Generate a short, unique username from a human-readable base. */
const createUsername = (base: string) => {
  const safeBase = sanitizeKey(base).replace(/_/g, "").slice(0, 8) || "tnruser";
  const suffix = randomBytes(2).toString("hex");
  return `${safeBase}${suffix}`.slice(0, 12);
};

/** Look up the village by ID or name; throws if not found. */
const resolveVillage = async (profile: AiTestUserProfile) => {
  if (profile.villageId) {
    const villageRecord = await drizzleDB.query.village.findFirst({
      where: eq(village.id, profile.villageId),
      columns: { id: true, name: true },
    });
    if (villageRecord) return villageRecord;
    throw new Error(
      `Village with id "${profile.villageId}" not found for profile key ${profile.key}`,
    );
  }

  if (profile.villageName) {
    const villageRecord = await drizzleDB.query.village.findFirst({
      where: eq(village.name, profile.villageName),
      columns: { id: true, name: true },
    });
    if (villageRecord) return villageRecord;
  }

  throw new Error(`Village not found for profile key ${profile.key}`);
};

const findUserByExternalId = async (externalId: string) => {
  const users = (await fetchClerkApi(
    `/users?limit=1&external_id=${encodeURIComponent(externalId)}`,
    { method: "GET" },
  )) as Array<{ id: string }>;
  return users[0];
};

const findUserByEmail = async (email: string) => {
  const users = (await fetchClerkApi(
    `/users?limit=1&email_address=${encodeURIComponent(email)}`,
    { method: "GET" },
  )) as Array<{ id: string }>;
  return users[0];
};

/**
 * Find-or-create a Clerk user with a stable external_id.
 *
 * Strategy:
 *  1. Look up by external_id (fast path for repeat runs).
 *  2. If not found, CREATE with external_id + email.
 *  3. If CREATE fails (e.g. email collision from a pre-external_id run),
 *     fall back to email lookup and PATCH the external_id onto that user.
 */
const upsertClerkUser = async (
  externalId: string,
  email: string,
  username: string,
  password: string,
): Promise<{ userId: string }> => {
  // Step 1: fast path — user already has our external_id from a previous run
  const existingByExtId = await findUserByExternalId(externalId);
  if (existingByExtId?.id) {
    const updated = (await fetchClerkApi(`/users/${existingByExtId.id}`, {
      method: "PATCH",
      body: JSON.stringify({ username, password, skip_password_checks: true }),
    })) as { id: string };
    return { userId: updated.id };
  }

  // Step 2: try creating a brand-new Clerk user
  try {
    const created = (await fetchClerkApi("/users", {
      method: "POST",
      body: JSON.stringify({
        external_id: externalId,
        username,
        password,
        skip_password_checks: true,
        email_address: [email],
      }),
    })) as { id: string };
    return { userId: created.id };
  } catch (_createError) {
    // Step 3: creation failed (likely email collision from a run before
    // external_id was introduced) — adopt the existing user
    const existingByEmail = await findUserByEmail(email);
    if (existingByEmail?.id) {
      const updated = (await fetchClerkApi(`/users/${existingByEmail.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          external_id: externalId,
          username,
          password,
          skip_password_checks: true,
        }),
      })) as { id: string };
      return { userId: updated.id };
    }
    // Not an email collision — surface the original error
    throw _createError;
  }
};

/** Sync the Clerk user into the app's `userData` table (insert or reset). */
const upsertUserData = async ({
  userId,
  username,
  level,
  rank,
  villageId,
  isBanned,
}: {
  userId: string;
  username: string;
  level: number;
  rank: (typeof UserRanks)[number];
  villageId: string;
  isBanned: boolean;
}) => {
  const existing = await drizzleDB.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true },
  });

  if (!existing) {
    await drizzleDB.insert(userData).values({
      userId,
      username,
      gender: "Other",
      level,
      rank,
      villageId,
      status: "AWAKE",
      isBanned,
    });
    return;
  }

  // Reset combat/location flags so the user starts in a clean state
  await drizzleDB
    .update(userData)
    .set({
      username,
      level,
      rank,
      villageId,
      status: "AWAKE",
      inArena: false,
      inShrines: false,
      isOutlaw: false,
      isBanned,
    })
    .where(eq(userData.userId, userId));
};

/** Request a Clerk testing token (used by Clerk's testing mode, not required). */
const createTestingToken = async (): Promise<string | undefined> => {
  try {
    const response = (await fetchClerkApi("/testing_tokens", {
      method: "POST",
      body: JSON.stringify({}),
    })) as { token?: string };
    return response.token;
  } catch (_error) {
    return undefined;
  }
};

/** Generate a one-time Clerk sign-in token for passwordless browser login. */
const createSignInToken = async (userId: string): Promise<string | undefined> => {
  try {
    const response = (await fetchClerkApi("/sign_in_tokens", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    })) as { token?: string };
    return response.token;
  } catch (_error) {
    return undefined;
  }
};

const BROKER_VERSION = "v4-email-fix";

/**
 * Provision one or more test users for a single reviewer run.
 *
 * For each profile: resolves the village, upserts the Clerk user, syncs the
 * DB row, and generates a sign-in token — all in parallel across profiles.
 */
export const provisionAiTestUsers = async (
  profiles: AiTestUserProfile[],
  runId: string,
): Promise<{
  users: ProvisionedAiTestUser[];
  testingToken?: string;
  version?: string;
}> => {
  // Provision all profiles in parallel — each profile is independent
  const users = await Promise.all(
    profiles.map(async (profile) => {
      const resolvedVillage = await resolveVillage(profile);
      const password = createPassword();
      const userKey = sanitizeKey(profile.key);
      const runKey = sanitizeKey(runId);
      const usernameBase = profile.preferredUsername
        ? profile.preferredUsername
        : `tnr${runKey}${userKey}`;
      const username = createUsername(usernameBase);

      // Deterministic external_id so repeat runs reuse the same Clerk user
      const externalId = `tnr-test-${runKey}-${userKey}`;
      // Capped at 64 chars to satisfy Clerk's email local-part limit.
      // Uses example.org (RFC 2606) — Clerk rejects .test TLD.
      const localPart = `tnr-${runKey}-${userKey}`.slice(0, 64);
      const email = `${localPart}@tnr-ci.example.org`;

      const { userId } = await upsertClerkUser(externalId, email, username, password);

      // DB sync and sign-in token generation are independent — run in parallel
      const [, signInToken] = await Promise.all([
        upsertUserData({
          userId,
          username,
          level: profile.level,
          rank: profile.rank,
          villageId: resolvedVillage.id,
          isBanned: profile.isBanned ?? false,
        }),
        createSignInToken(userId),
      ]);

      return {
        key: profile.key,
        userId,
        username,
        email,
        password,
        level: profile.level,
        rank: profile.rank,
        villageId: resolvedVillage.id,
        villageName: resolvedVillage.name,
        isBanned: profile.isBanned ?? false,
        signInToken,
      };
    }),
  );

  const testingToken = await createTestingToken();
  return { users, testingToken, version: BROKER_VERSION };
};
