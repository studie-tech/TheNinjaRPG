import { and, eq, isNull, sql } from "drizzle-orm";
import type { UserData } from "@/drizzle/schema";
import { userData } from "@/drizzle/schema";

/** Claim combat only with the bloodline and purchased effects that were preloaded. */
export const matchBloodrightSnapshot = (
  user: Pick<UserData, "userId" | "bloodlineId" | "bloodright">,
) =>
  and(
    eq(userData.userId, user.userId),
    user.bloodlineId === null
      ? isNull(userData.bloodlineId)
      : eq(userData.bloodlineId, user.bloodlineId),
    sql`${userData.bloodright} = CAST(${JSON.stringify(user.bloodright)} AS JSON)`,
  );

/** Refund at the saved purchase prices, in the same statement that changes the bloodline. */
export const bloodrightSwapRefund = (bloodlineId: string | null) => {
  const changed = sql`NOT (${userData.bloodlineId} <=> ${bloodlineId})`;
  // UserData declares refund fields before bloodlineId because MySQL evaluates SET left to right.
  return {
    seichiSilver: sql`${userData.seichiSilver} + IF(${changed}, ${userData.bloodrightSpent}, 0)`,
    bloodright: sql`IF(${changed}, JSON_ARRAY(), ${userData.bloodright})`,
    bloodrightSpent: sql`IF(${changed}, 0, ${userData.bloodrightSpent})`,
  };
};

/** Removing a prerequisite also removes every transitive dependent. */
export const getBloodrightRefundIds = (
  skillId: string,
  purchasedIds: string[],
  tiers: { id: string; requiredSkillIds: string[] }[],
) => {
  const removed = new Set([skillId]);
  let previousSize = 0;
  while (previousSize !== removed.size) {
    previousSize = removed.size;
    for (const tier of tiers) {
      if (
        purchasedIds.includes(tier.id) &&
        tier.requiredSkillIds.some((id) => removed.has(id))
      ) {
        removed.add(tier.id);
      }
    }
  }
  return purchasedIds.filter((id) => removed.has(id));
};
