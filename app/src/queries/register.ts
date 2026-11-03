/**
 * Database access for register; authorization and transaction scopes stay in callers.
 */
import { and, eq, getTableColumns, inArray, or, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type RecruitEligibilityReason,
  TUTORIAL_STARTER_QUEST_ID,
  type UserRole,
} from "@/drizzle/constants";
import {
  activityStreakConfig,
  bloodlineRolls,
  historicalIp,
  paypalSubscription,
  questHistory,
  recruitReferral,
  referralSource,
  storePurchase,
  storeUserIdAlias,
  stripePayment,
  userAttribute,
  userData,
  userItem,
  userReport,
  userStreakProgress,
  village,
  visitorLog,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { createStarterHomeItems } from "@/server/utils/homeFurniture";
import { hashIp } from "@/server/utils/ipHash";

/** Build the `referralSource` lookup for `setReferralSource`, using predicates on `userId`. */
export const findReferralSourceForSetReferralSource = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.referralSource.findFirst({
    where: eq(referralSource.userId, ctx.userId),
  });

/** Build the `visitorLog` lookup for `setReferralSource`, using predicates on `ipHash`. */
export const findVisitorLogForSetReferralSource = (
  client: Pick<DrizzleClient, "query">,
  ip: string,
) =>
  client.query.visitorLog.findFirst({
    where: eq(visitorLog.ipHash, hashIp(ip)),
  });

/** Build the `historicalIp` lookup for `setReferralSource`, using predicates on `ip` and `userId`. */
export const findHistoricalIpForSetReferralSource = (
  client: Pick<DrizzleClient, "query">,
  ip: string,
  ctx: { userId: string },
) =>
  client.query.historicalIp.findFirst({
    where: and(eq(historicalIp.ip, ip), eq(historicalIp.userId, ctx.userId)),
  });

/** Build a historical IP insert with its matching IP hash. */
export const insertUserHistoricalIp = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  ip: string,
) => client.insert(historicalIp).values({ userId: userId, ip, ipHash: hashIp(ip) });

/** Build the `referralSource` insert for `setReferralSource`. */
export const insertReferralSourceForSetReferralSource = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  source: string,
) =>
  client.insert(referralSource).values({
    id: nanoid(),
    userId: ctx.userId,
    source,
  });

/** Build the `village` lookup for `createCharacter`, using predicates on `name`. */
export const findVillageForCreateCharacter = (client: Pick<DrizzleClient, "query">) =>
  client.query.village.findFirst({
    where: eq(village.name, "Horizon"),
  });

/** Build the `userData` lookup for `createCharacter`, using predicates on `username`. */
export const findUserDataForCreateCharacter2 = (
  client: Pick<DrizzleClient, "query">,
  input: { username: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.username, input.username),
  });

/** Build the `historicalIp` lookup for `createCharacter`, using predicates on `ip` and `userId`. */
export const findHistoricalIpForCreateCharacter = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userIp: string; userId: string },
) =>
  client.query.historicalIp.findFirst({
    where: and(
      eq(historicalIp.ip, ctx.userIp ?? ""),
      eq(historicalIp.userId, ctx.userId),
    ),
  });

/** Build the `storePurchase` lookup for `createCharacter`, selecting only `id`, using predicates on `userId`. */
export const findStorePurchaseForCreateCharacter = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.storePurchase.findFirst({
    columns: { id: true },
    where: eq(storePurchase.userId, ctx.userId),
  });

/**
 * Build the `paypalSubscription` lookup for `createCharacter`, selecting only `id`,
 * using predicates on `affectedUserId`.
 */
export const findPaypalSubscriptionForCreateCharacter = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.paypalSubscription.findFirst({
    columns: { id: true },
    where: eq(paypalSubscription.affectedUserId, ctx.userId),
  });

/** Build the `stripePayment` lookup for `createCharacter`, selecting only `id`, using predicates on `affectedUserId`. */
export const findStripePaymentForCreateCharacter = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.stripePayment.findFirst({
    columns: { id: true },
    where: eq(stripePayment.affectedUserId, ctx.userId),
  });

/**
 * Build the `userReport` listing for `createCharacter`, selecting only `id`, using
 * predicates on `reportedUserId` and `system`.
 */
export const listUserReportForCreateCharacter = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userReport.findMany({
    columns: { id: true },
    where: and(
      eq(userReport.reportedUserId, ctx.userId),
      eq(userReport.system, "sanction_carryover"),
    ),
  });

/** Execute the database statement for `createCharacter`. */
export const executeCreatedUserForCreateCharacter = (
  client: Pick<DrizzleClient, "execute">,
  values: Pick<
    import("@/drizzle/schema").UserData,
    | "sector"
    | "userId"
    | "username"
    | "joinedVillageAt"
    | "isBanned"
    | "isSilenced"
    | "immunityUntil"
    | "extraJutsuSlots"
    | "musicOn"
    | "sfxOn"
    | "buttonSfxOn"
  > & {
    earnedExperience?: undefined | number;
    lastIp: string;
    recruiterId: undefined | null | string;
    gender: import("@/validators/register").Gender;
    avatar: string;
    villageId: string;
    bloodlineId: string;
    approvedTos: true;
  },
  sanctionGuard: undefined | SQL<unknown>,
  input: { username: string },
) => {
  const columns = getTableColumns(userData);
  const keys = Object.keys(values) as (keyof typeof values)[];
  return client.execute(sql`
        INSERT INTO ${userData} (${sql.join(
          keys.map((key) => sql.identifier(columns[key].name)),
          sql`, `,
        )})
        SELECT ${sql.join(
          keys.map((key) => sql.param(values[key] ?? null, columns[key])),
          sql`, `,
        )}
        WHERE ${sanctionGuard} AND NOT EXISTS (SELECT 1 FROM ${userData} WHERE ${eq(userData.username, input.username)})
      `);
};

/**
 * Build the `userData` lookup for `createCharacter`, selecting only `userId`, using
 * predicates on `userId` and `username`.
 */
export const findUserDataForCreateCharacter3 = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { username: string },
) =>
  client.query.userData.findFirst({
    columns: { userId: true },
    where: or(eq(userData.userId, ctx.userId), eq(userData.username, input.username)),
  });

/** Build the `storeUserIdAlias` deletion for `createCharacter`, using predicates on `oldUserId` and `newUserId`. */
export const deleteStoreUserIdAliasForCreateCharacter = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  storeAlias: { newUserId: string },
) =>
  client
    .delete(storeUserIdAlias)
    .where(
      and(
        eq(storeUserIdAlias.oldUserId, ctx.userId),
        eq(storeUserIdAlias.newUserId, storeAlias.newUserId),
      ),
    );

/** Build insertion of a user’s starter home inventory rows. */
export const insertStarterHomeItems = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
) => client.insert(userItem).values(createStarterHomeItems(userId));

/** Build the `questHistory` insert for `createCharacter`, updating duplicate keys. */
export const insertQuestHistoryForCreateCharacter = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
) =>
  client
    .insert(questHistory)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      questId: TUTORIAL_STARTER_QUEST_ID,
      questType: "starter",
      startedAt: new Date(),
      endAt: null,
      completed: 0,
      previousCompletes: 0,
      previousAttempts: 1,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `userAttribute` insert for `createCharacter`, updating duplicate keys. */
export const insertUserAttributeForCreateCharacter = (
  client: Pick<DrizzleClient, "insert">,
  unique_attributes: string[],
  ctx: { userId: string },
) =>
  client
    .insert(userAttribute)
    .values(
      unique_attributes.map((attribute) => ({
        id: nanoid(),
        attribute: attribute,
        userId: ctx.userId,
      })),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `bloodlineRolls` insert for `createCharacter`. */
export const insertBloodlineRollsForCreateCharacter = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  selectedBloodline: { id: string; rank: "D" },
) =>
  client.insert(bloodlineRolls).values({
    id: nanoid(),
    userId: ctx.userId,
    type: "REGISTRATION",
    bloodlineId: selectedBloodline.id,
    goal: selectedBloodline.rank,
    used: 1,
    pityRolls: 0,
  });

/** Build the `userData` update for `createCharacter`, setting `nRecruited`, using predicates on `userId`. */
export const updateUserDataForCreateCharacter = (
  client: Pick<DrizzleClient, "update">,
  input: { recruiter_userid: string },
) =>
  client
    .update(userData)
    .set({ nRecruited: sql`${userData.nRecruited} + 1` })
    .where(eq(userData.userId, input.recruiter_userid));

/** Build the `recruitReferral` insert for `createCharacter`, updating duplicate keys. */
export const insertRecruitReferralForCreateCharacter = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { recruiter_userid: string },
  recruitEligibility: {
    isEligible: false | true;
    reason: RecruitEligibilityReason;
  },
) =>
  client
    .insert(recruitReferral)
    .values({
      recruitUserId: ctx.userId,
      recruiterId: input.recruiter_userid,
      isEligible: recruitEligibility.isEligible,
      eligibilityReason: recruitEligibility.reason,
      eligibilityCheckedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        recruiterId: input.recruiter_userid,
        isEligible: recruitEligibility.isEligible,
        eligibilityReason: recruitEligibility.reason,
        eligibilityCheckedAt: new Date(),
      },
    });

/** Build the `village` lookup for `resolveVillage`, using predicates on `id`. */
export const findVillageForResolveVillage = (
  client: Pick<DrizzleClient, "query">,
  profile: { villageId: string },
  columns: { id: true; name: true; sector: true },
  withRelations: { structures: { columns: { route: true; name: true } } },
) =>
  client.query.village.findFirst({
    where: eq(village.id, profile.villageId),
    columns,
    with: withRelations,
  });

/** Build the `village` lookup for `resolveVillage`, using predicates on `name`. */
export const findVillageForResolveVillage2 = (
  client: Pick<DrizzleClient, "query">,
  profile: { villageName: string },
  columns: { id: true; name: true; sector: true },
  withRelations: { structures: { columns: { route: true; name: true } } },
) =>
  client.query.village.findFirst({
    where: eq(village.name, profile.villageName),
    columns,
    with: withRelations,
  });

/** Build the `activityStreakConfig` selection for `suppressActivityStreakPopup`, using predicates on `isActive`. */
export const selectActivityStreakConfigForSuppressActivityStreakPopup = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: activityStreakConfig.id })
    .from(activityStreakConfig)
    .where(eq(activityStreakConfig.isActive, true));

/**
 * Build the `userStreakProgress` selection for `suppressActivityStreakPopup`, using
 * predicates on `userId` and `configId`.
 */
export const selectUserStreakProgressForSuppressActivityStreakPopup = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  configs: Pick<import("@/drizzle/schema").DungeonRun, "id">[],
) =>
  client
    .select({ configId: userStreakProgress.configId })
    .from(userStreakProgress)
    .where(
      and(
        eq(userStreakProgress.userId, userId),
        inArray(
          userStreakProgress.configId,
          configs.map((c) => c.id),
        ),
      ),
    );

/** Build the `userStreakProgress` insert for `suppressActivityStreakPopup`. */
export const insertUserStreakProgressForSuppressActivityStreakPopup = (
  client: Pick<DrizzleClient, "insert">,
  missing: Pick<import("@/drizzle/schema").DungeonRun, "id">[],
  userId: string,
  now: Date,
) =>
  client.insert(userStreakProgress).values(
    missing.map((c) => ({
      id: `agentstreak-${userId}-${c.id}`.slice(0, 191),
      userId,
      configId: c.id,
      currentDay: 0,
      lastClaimDate: now,
      startedAt: now,
    })),
  );

/**
 * Build the `userStreakProgress` update for `suppressActivityStreakPopup`, setting
 * `currentDay` and `lastClaimDate`, using predicates on `userId` and `configId`.
 */
export const updateUserStreakProgressForSuppressActivityStreakPopup = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  userId: string,
  seeded: Set<string>,
) =>
  client
    .update(userStreakProgress)
    .set({ currentDay: 0, lastClaimDate: now })
    .where(
      and(
        eq(userStreakProgress.userId, userId),
        inArray(userStreakProgress.configId, [...seeded]),
      ),
    );

/** Build the `userData` insert for `upsertUserData`. */
export const insertUserDataForUpsertUserData = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  username: string,
  level: number,
  rank: import("@/drizzle/schema").UserRank,
  role: UserRole,
  villageId: string,
  sector: number,
  isBanned: false | true,
  AGENT_FRIENDLY_SETTINGS: { tutorialOn: false; tutorialStep: number; musicOn: false },
) =>
  client.insert(userData).values({
    userId,
    username,
    gender: "Other",
    level,
    rank,
    role,
    villageId,
    sector,
    status: "AWAKE",
    isBanned,
    ...AGENT_FRIENDLY_SETTINGS,
  });

/** Build the `userData` update for `upsertUserData`, using predicates on `userId`. */
export const updateUserDataForUpsertUserData = (
  client: Pick<DrizzleClient, "update">,
  username: string,
  level: number,
  rank: import("@/drizzle/schema").UserRank,
  role: UserRole,
  villageId: string,
  sector: number,
  isBanned: false | true,
  AGENT_FRIENDLY_SETTINGS: { tutorialOn: false; tutorialStep: number; musicOn: false },
  userId: string,
) =>
  client
    .update(userData)
    .set({
      username,
      level,
      rank,
      role,
      villageId,
      sector,
      status: "AWAKE",
      inArena: false,
      inShrines: false,
      isOutlaw: false,
      isBanned,
      ...AGENT_FRIENDLY_SETTINGS,
    })
    .where(eq(userData.userId, userId));
