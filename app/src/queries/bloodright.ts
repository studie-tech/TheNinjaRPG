/**
 * Database access for bloodright; authorization and transaction scopes stay in callers.
 */
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UserRole } from "@/drizzle/constants";
import { actionLog, skillTree, skillTreeFolder, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { canAccessHiddenSkillTree } from "@/utils/permissions";
import { getNextUserSnapshotAt } from "@/utils/time";

/** Build the `skillTree` listing for `get`, using predicates on `pathType`. */
export const listSkillTreeForGet = (client: Pick<DrizzleClient, "query">) =>
  client.query.skillTree.findMany({
    where: eq(skillTree.pathType, "BLOODRIGHT"),
    with: { folder: true },
    orderBy: [skillTree.tier, skillTree.name],
  });

/** Build the `userData` update for `purchase`, including predicates on `userId`, `bloodlineId`, `folderId`. */
export const updateUserDataForPurchase = (
  client: Pick<DrizzleClient, "update">,
  user: {
    updatedAt: Date;
    role: UserRole;
  },
  tier: { seichiSilverCost: number; bloodlineId: string; id: string; updatedAt: Date },
  bloodright: { skillId: string; cost: number }[],
  ctx: { userId: string },
  purchased: { skillId: string; cost: number }[],
) =>
  client
    .update(userData)
    .set({
      updatedAt: getNextUserSnapshotAt(user.updatedAt),
      seichiSilver: sql`${userData.seichiSilver} - ${tier.seichiSilverCost}`,
      bloodrightSpent: sql`${userData.bloodrightSpent} + ${tier.seichiSilverCost}`,
      bloodright,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.bloodlineId, tier.bloodlineId),
        // Content may change between loading the card and claiming its purchase.
        sql`EXISTS (SELECT 1 FROM ${skillTree} LEFT JOIN ${skillTreeFolder} ON ${skillTree.folderId} = ${skillTreeFolder.id} WHERE ${skillTree.id} = ${tier.id} AND ${skillTree.updatedAt} = ${tier.updatedAt} AND (${canAccessHiddenSkillTree(user.role)} OR (${skillTree.hidden} = false AND COALESCE(${skillTreeFolder.hidden}, false) = false)))`,
        ne(userData.status, "BATTLE"),
        sql`${userData.bloodright} = CAST(${JSON.stringify(purchased)} AS JSON)`,
        gte(userData.seichiSilver, tier.seichiSilverCost),
      ),
    );

/** Build the `skillTree` listing for `refund`, using predicates on `pathType`. */
export const listSkillTreeForRefund = (client: Pick<DrizzleClient, "query">) =>
  client.query.skillTree.findMany({
    where: eq(skillTree.pathType, "BLOODRIGHT"),
  });

/** Build the `userData` update for `refund`, using predicates on `userId`, `status`, `bloodright`. */
export const updateUserDataForRefund = (
  client: Pick<DrizzleClient, "update">,
  user: { updatedAt: Date; bloodright: { skillId: string; cost: number }[] },
  refund: number,
  bloodright: { skillId: string; cost: number }[],
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
    bloodright: { skillId: string; cost: number }[];
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
    relatedMsg: isStaff ? "Free reset for staff member" : "Bloodright reset",
    relatedValue: cost,
    relatedImage: user.avatarLight,
  });
