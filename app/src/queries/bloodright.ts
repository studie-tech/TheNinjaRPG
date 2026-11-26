/**
 * Database access for bloodright; authorization and transaction scopes stay in callers.
 */
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UserRole } from "@/drizzle/constants";
import { SKILL_RESET_STAFF_RELATED_MSG } from "@/drizzle/constants";
import { actionLog, bloodrightOption, jutsu, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { canAccessHiddenSkillTree, getContentRole } from "@/utils/permissions";
import { getNextUserSnapshotAt } from "@/utils/time";
import type { BloodrightOptionData } from "@/validators/bloodright";

/** Load options with their source jutsu for validation and preview. */
export const listBloodrightOptions = (client: Pick<DrizzleClient, "query">) =>
  client.query.bloodrightOption.findMany({
    with: { jutsu: true },
    orderBy: [bloodrightOption.name],
  });

/** Fetch a single option and the jutsu whose tags it changes. */
export const findBloodrightOption = (
  client: Pick<DrizzleClient, "query">,
  id: string,
) =>
  client.query.bloodrightOption.findFirst({
    where: eq(bloodrightOption.id, id),
    with: { jutsu: true },
  });

/** Preload jutsu lineage for evolution and mechanics-reskin inheritance. */
export const listBloodrightJutsuIdentities = (client: Pick<DrizzleClient, "query">) =>
  client.query.jutsu.findMany({
    columns: { id: true, parentJutsuId: true, reskinParentJutsuId: true },
  });

/** Preload every participating bloodline's jutsu, including unequipped lobby choices. */
export const listBattleBloodrightJutsus = (
  client: Pick<DrizzleClient, "query" | "select">,
  userIds: string[],
) =>
  client.query.jutsu.findMany({
    columns: { id: true, effects: true },
    where: inArray(
      jutsu.bloodlineId,
      client
        .select({ bloodlineId: userData.bloodlineId })
        .from(userData)
        .where(inArray(userData.userId, userIds)),
    ),
  });

/** List a bloodline's jutsu for the dedicated content editor. */
export const listBloodrightJutsus = (
  client: Pick<DrizzleClient, "query">,
  bloodlineId: string,
) =>
  client.query.jutsu.findMany({
    where: eq(jutsu.bloodlineId, bloodlineId),
    orderBy: [jutsu.name],
  });

/** Load the option's bloodline jutsu so inherited combinations are checked before payment. */
export const listBloodrightPurchaseJutsus = (
  client: Pick<DrizzleClient, "query" | "select">,
  optionId: string,
) =>
  client.query.jutsu.findMany({
    where: inArray(
      jutsu.bloodlineId,
      client
        .select({ bloodlineId: bloodrightOption.bloodlineId })
        .from(bloodrightOption)
        .where(eq(bloodrightOption.id, optionId)),
    ),
  });

/** Debit Silver and claim an option against both account and content snapshots. */
export const updateUserDataForPurchase = (
  client: Pick<DrizzleClient, "update">,
  user: { updatedAt: Date; role: UserRole; playsAsPlayer: boolean },
  option: {
    seichiSilverCost: number;
    bloodlineId: string;
    id: string;
    updatedAt: Date;
    jutsu: { id: string; updatedAt: Date };
  },
  bloodright: { optionId: string; cost: number }[],
  ctx: { userId: string },
  purchased: { optionId: string; cost: number }[],
) =>
  client
    .update(userData)
    .set({
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
      seichiSilver: sql`${userData.seichiSilver} - ${option.seichiSilverCost}`,
      bloodrightSpent: sql`${userData.bloodrightSpent} + ${option.seichiSilverCost}`,
      bloodright,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.bloodlineId, option.bloodlineId),
        sql`EXISTS (SELECT 1 FROM ${bloodrightOption} JOIN ${jutsu} ON ${jutsu.id} = ${bloodrightOption.jutsuId} WHERE ${bloodrightOption.id} = ${option.id} AND ${bloodrightOption.updatedAt} = ${option.updatedAt} AND ${jutsu.updatedAt} = ${option.jutsu.updatedAt} AND ${jutsu.bloodlineId} = ${option.bloodlineId} AND (${canAccessHiddenSkillTree(getContentRole(user))} OR (${bloodrightOption.hidden} = false AND ${jutsu.hidden} = false)))`,
        ne(userData.status, "BATTLE"),
        sql`${userData.bloodright} = CAST(${JSON.stringify(purchased)} AS JSON)`,
        gte(userData.seichiSilver, option.seichiSilverCost),
      ),
    );

/** Save content against the option and source jutsu snapshots. */
export const saveBloodrightOption = (
  client: Pick<DrizzleClient, "execute" | "update">,
  id: string,
  data: BloodrightOptionData,
  source: { updatedAt: Date },
  expectedUpdatedAt?: Date,
) => {
  // INSERT ... SELECT locks the source while creating its dependent option, so a
  // concurrent jutsu deletion cannot leave an option pointing at a missing row.
  if (!expectedUpdatedAt)
    return client.execute(sql`INSERT INTO ${bloodrightOption}
      (id, bloodlineId, jutsuId, name, description, seichiSilverCost, hidden, changes)
      SELECT ${id}, ${data.bloodlineId}, ${data.jutsuId}, ${data.name}, ${data.description}, ${data.seichiSilverCost}, ${data.hidden}, CAST(${JSON.stringify(data.changes)} AS JSON)
      FROM ${jutsu} WHERE ${jutsu.id} = ${data.jutsuId} AND ${jutsu.updatedAt} = ${source.updatedAt}`);
  return client
    .update(bloodrightOption)
    .set({ ...data, updatedAt: getNextUserSnapshotAt(expectedUpdatedAt) })
    .where(
      and(
        eq(bloodrightOption.id, id),
        eq(bloodrightOption.updatedAt, expectedUpdatedAt),
        sql`EXISTS (SELECT 1 FROM ${jutsu} WHERE ${jutsu.id} = ${data.jutsuId} AND ${jutsu.updatedAt} = ${source.updatedAt})`,
        sql`(NOT EXISTS (SELECT 1 FROM ${userData} WHERE JSON_SEARCH(${userData.bloodright}, 'one', ${id}, NULL, '$[*].optionId') IS NOT NULL) OR (${bloodrightOption.bloodlineId} = ${data.bloodlineId} AND ${bloodrightOption.jutsuId} = ${data.jutsuId} AND ${bloodrightOption.changes} = CAST(${JSON.stringify(data.changes)} AS JSON)))`,
      ),
    );
};

/** Delete content only when nobody owns the option. */
export const deleteBloodrightOption = (
  client: Pick<DrizzleClient, "delete">,
  id: string,
) =>
  client
    .delete(bloodrightOption)
    .where(
      and(
        eq(bloodrightOption.id, id),
        sql`NOT EXISTS (SELECT 1 FROM ${userData} WHERE JSON_SEARCH(${userData.bloodright}, 'one', ${id}, NULL, '$[*].optionId') IS NOT NULL)`,
      ),
    );

/** Record a staff content change using the shared ActionLog convention. */
export const logBloodrightContent = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  id: string,
  name: string,
  changes: string[],
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId,
    tableName: "bloodrightOption",
    relatedId: id,
    relatedMsg: name,
    changes,
  });

/** Build the `userData` update for `refund`, using predicates on `userId`, `status`, `bloodright`. */
export const updateUserDataForRefund = (
  client: Pick<DrizzleClient, "update">,
  user: { updatedAt: Date; bloodright: { optionId: string; cost: number }[] },
  refund: number,
  bloodright: { optionId: string; cost: number }[],
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
      seichiSilver: sql`${userData.seichiSilver} + ${refund}`,
      bloodrightSpent: sql`${userData.bloodrightSpent} - ${refund}`,
      bloodright,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        ne(userData.status, "BATTLE"),
        sql`${userData.bloodright} = CAST(${JSON.stringify(user.bloodright)} AS JSON)`,
      ),
    );

/** Build the `userData` update for `reset`, including predicates on `userId`, `status`, `bloodright`. */
export const updateUserDataForReset = (
  client: Pick<DrizzleClient, "update">,
  user: {
    updatedAt: Date;
    bloodright: { optionId: string; cost: number }[];
    monthlySkillResets: { month: string; count: number };
    bloodrightSpent: number;
  },
  cost: 0 | 30,
  monthlySkillResets: { count: number; month: string },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
      seichiSilver: sql`${userData.seichiSilver} + ${userData.bloodrightSpent}`,
      bloodrightSpent: 0,
      bloodright: [],
      reputationPoints: sql`${userData.reputationPoints} - ${cost}`,
      monthlySkillResets,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        ne(userData.status, "BATTLE"),
        sql`${userData.bloodright} = CAST(${JSON.stringify(user.bloodright)} AS JSON)`,
        sql`${userData.monthlySkillResets} = CAST(${JSON.stringify(user.monthlySkillResets)} AS JSON)`,
        // The confirmed refund delta must equal the SQL expression's committed amount.
        eq(userData.bloodrightSpent, user.bloodrightSpent),
        gte(userData.reputationPoints, cost),
      ),
    );

/** Build the `actionLog` insert for `reset`. */
export const insertActionLogForReset = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  isStaff: false | true,
  cost: 0 | 30,
  user: { avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "skillReset",
    changes: ["Bloodright reset"],
    relatedMsg: isStaff ? SKILL_RESET_STAFF_RELATED_MSG : "Bloodright reset",
    relatedValue: cost,
    relatedImage: user.avatarLight,
  });
