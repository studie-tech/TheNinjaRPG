import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { UserRanks } from "@/drizzle/constants";
import { userData, village } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { drizzleDB } from "@/server/db";
import type { AiTestUserProfile } from "@/validators/ai-test-user";

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

const CLERK_API_ENDPOINT = "https://api.clerk.com/v1";

const buildMachineHeaders = () => {
  if (!env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required for AI test-user provisioning");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
  };
};

const fetchClerkApi = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${CLERK_API_ENDPOINT}${path}`, {
    ...init,
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

const sanitizeKey = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

const createPassword = () => `Tnr!${randomBytes(10).toString("hex")}1A`;
const createUsername = (base: string) => {
  const safeBase = sanitizeKey(base).replace(/_/g, "").slice(0, 8) || "tnruser";
  const suffix = randomBytes(2).toString("hex");
  return `${safeBase}${suffix}`.slice(0, 12);
};

const resolveVillage = async (profile: AiTestUserProfile) => {
  if (profile.villageId) {
    const villageRecord = await drizzleDB.query.village.findFirst({
      where: eq(village.id, profile.villageId),
      columns: { id: true, name: true },
    });
    if (villageRecord) return villageRecord;
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

const upsertClerkUser = async (
  externalId: string,
  email: string,
  username: string,
  password: string,
): Promise<{ userId: string }> => {
  const existingUsers = (await fetchClerkApi(
    `/users?limit=1&external_id[]=${encodeURIComponent(externalId)}`,
    { method: "GET" },
  )) as Array<{ id: string }>;

  const existingUser = existingUsers[0];
  if (existingUser?.id) {
    const updated = (await fetchClerkApi(`/users/${existingUser.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        username,
        password,
        skip_password_checks: true,
      }),
    })) as { id: string };

    return { userId: updated.id };
  }

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
};

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

export const provisionAiTestUsers = async (
  profiles: AiTestUserProfile[],
  runId: string,
): Promise<{ users: ProvisionedAiTestUser[]; testingToken?: string }> => {
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
      const externalId = `tnr-test-${runKey}-${userKey}`;
      const email = `tnr-${runKey}-${userKey}@theninjarpg.test`;

      const { userId } = await upsertClerkUser(externalId, email, username, password);
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
  return { users, testingToken };
};
