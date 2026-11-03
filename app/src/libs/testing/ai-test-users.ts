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
import { createHash, randomBytes } from "node:crypto";
import {
  TUTORIAL_STEPS_COUNT,
  type UserRank,
  type UserRole,
} from "@/drizzle/constants";
import { env } from "@/env/server.mjs";
import { findUserIdentityById } from "@/queries/profile";
import {
  findVillageForResolveVillage,
  findVillageForResolveVillage2,
  insertStarterHomeItems,
  insertUserDataForUpsertUserData,
  insertUserStreakProgressForSuppressActivityStreakPopup,
  selectActivityStreakConfigForSuppressActivityStreakPopup,
  selectUserStreakProgressForSuppressActivityStreakPopup,
  updateUserDataForUpsertUserData,
  updateUserStreakProgressForSuppressActivityStreakPopup,
} from "@/queries/register";
import { drizzleDB } from "@/server/db";
import { type AiTestUserProfile, sanitizeKey } from "@/validators/ai-test-user";

/** Shape returned per user after successful provisioning. */
type ProvisionedAiTestUser = {
  key: string;
  userId: string;
  username: string;
  email: string;
  password: string;
  level: number;
  rank: UserRank;
  role: UserRole;
  villageId: string;
  villageName: string;
  villageSector: number;
  villageStructures: Array<{ route: string; name: string }>;
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
  const columns = { id: true, name: true, sector: true } as const;
  const withRelations = {
    structures: { columns: { route: true, name: true } },
  } as const;

  if (profile.villageId) {
    const villageRecord = await findVillageForResolveVillage(
      drizzleDB,
      { villageId: profile.villageId },
      columns,
      withRelations,
    );
    if (villageRecord) return villageRecord;
    throw new Error(
      `Village with id "${profile.villageId}" not found for profile key ${profile.key}`,
    );
  }

  if (profile.villageName) {
    const villageRecord = await findVillageForResolveVillage2(
      drizzleDB,
      { villageName: profile.villageName },
      columns,
      withRelations,
    );
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
 *  3. If CREATE fails, adopt a user already created with this deterministic
 *     email (a concurrent request for the same run, or a create that timed
 *     out client-side after Clerk accepted it) and PATCH the external_id onto it.
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
    // Step 3: creation failed — adopt a user that already holds this email
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

/**
 * Settings that keep a provisioned account out of an agent's way: no tutorial
 * walkthrough and no background music. Applied on both create and reset so a
 * reused account behaves identically to a fresh one.
 *
 * These are ordinary user preferences, so this changes nothing for real players
 * -- it only picks non-default values at provisioning time.
 */
const AGENT_FRIENDLY_SETTINGS = {
  tutorialOn: false,
  tutorialStep: TUTORIAL_STEPS_COUNT,
  musicOn: false,
} as const;

/**
 * Pre-claim today's activity streaks so the "Daily Activity Rewards" dialog does
 * not open over the UI on first load.
 *
 * Done by seeding progress rows rather than by special-casing the popup, so no
 * gameplay code has to know test users exist. Each of the three popup triggers
 * is covered: `currentDay: 0` keeps `isBehind` false (no catch-up prompt), a
 * `lastClaimDate` of now makes `alreadyClaimedToday` true (nothing claimable),
 * and having a row at all clears `activeRecurringConfig` (no enrolment prompt).
 */
const suppressActivityStreakPopup = async (userId: string) => {
  const configs =
    await selectActivityStreakConfigForSuppressActivityStreakPopup(drizzleDB);
  if (configs.length === 0) return;

  const existing = await selectUserStreakProgressForSuppressActivityStreakPopup(
    drizzleDB,
    userId,
    configs,
  );
  const seeded = new Set(existing.map((e) => e.configId));
  const now = new Date();
  const missing = configs.filter((c) => !seeded.has(c.id));
  if (missing.length > 0) {
    await insertUserStreakProgressForSuppressActivityStreakPopup(
      drizzleDB,
      missing,
      userId,
      now,
    );
  }
  if (seeded.size > 0) {
    await updateUserStreakProgressForSuppressActivityStreakPopup(
      drizzleDB,
      now,
      userId,
      seeded,
    );
  }
};

/** Sync the Clerk user into the app's `userData` table (insert or reset). */
const upsertUserData = async ({
  userId,
  username,
  level,
  rank,
  role,
  villageId,
  isBanned,
  sector,
}: {
  userId: string;
  username: string;
  level: number;
  rank: UserRank;
  role: UserRole;
  villageId: string;
  isBanned: boolean;
  sector: number;
}) => {
  const existing = await findUserIdentityById(drizzleDB, userId);

  if (!existing) {
    await insertUserDataForUpsertUserData(
      drizzleDB,
      userId,
      username,
      level,
      rank,
      role,
      villageId,
      sector,
      isBanned,
      AGENT_FRIENDLY_SETTINGS,
    );
    await Promise.all([
      insertStarterHomeItems(drizzleDB, userId),
      suppressActivityStreakPopup(userId),
    ]);
    return;
  }

  // Reset combat/location flags so the user starts in a clean state
  await updateUserDataForUpsertUserData(
    drizzleDB,
    username,
    level,
    rank,
    role,
    villageId,
    sector,
    isBanned,
    AGENT_FRIENDLY_SETTINGS,
    userId,
  );
  await suppressActivityStreakPopup(userId);
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

/**
 * Provision one or more test users for a single reviewer run.
 *
 * For each profile: resolves the village, upserts the Clerk user, syncs the
 * DB row, and generates a sign-in token — all in parallel across profiles.
 */
export const provisionAiTestUsers = async (
  profiles: AiTestUserProfile[],
  runId: string,
): Promise<{ users: ProvisionedAiTestUser[] }> => {
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
      // Use a hash-based local part to guarantee uniqueness even with long runKeys.
      // Plain truncation could drop the userKey, aliasing multiple profiles to one email.
      const emailHash = createHash("sha256")
        .update(`${runKey}:${userKey}`)
        .digest("hex")
        .slice(0, 24);
      const localPart = `tnr-${emailHash}`;
      const email = `${localPart}@tnr-ci.example.org`;

      const { userId } = await upsertClerkUser(externalId, email, username, password);

      const resolvedRole = profile.role ?? "USER";

      // DB sync and sign-in token generation are independent — run in parallel
      const [, signInToken] = await Promise.all([
        upsertUserData({
          userId,
          username,
          level: profile.level,
          rank: profile.rank,
          role: resolvedRole,
          villageId: resolvedVillage.id,
          isBanned: profile.isBanned ?? false,
          sector: resolvedVillage.sector,
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
        role: resolvedRole,
        villageId: resolvedVillage.id,
        villageName: resolvedVillage.name,
        villageSector: resolvedVillage.sector,
        villageStructures: resolvedVillage.structures.map((s) => ({
          route: s.route,
          name: s.name,
        })),
        isBanned: profile.isBanned ?? false,
        signInToken,
      };
    }),
  );

  return { users };
};
