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
