import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  sql,
  sum,
} from "drizzle-orm";
import {
  BALANCE_EXCLUSION_IDS,
  type BattleType,
  type UserRank,
} from "@/drizzle/constants";
import {
  bloodline,
  type DataBattleTurnOrder,
  dataBattleAction,
  dataBattleTurnOrder,
  item,
  jutsu,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { getBalancePeriodStart } from "@/utils/time";

export type BalanceFilters = {
  battleTypes?: BattleType[];
  userRanks?: UserRank[];
  minLevel?: number;
  maxLevel?: number;
};

/** Restrict live reports to the active fortnight and the player's frozen demographics. */
export const balanceConditions = (
  input: BalanceFilters = {},
  periodStart = getBalancePeriodStart(),
) => [
  eq(dataBattleAction.periodStart, periodStart),
  ...(input.battleTypes?.length
    ? [inArray(dataBattleAction.battleType, input.battleTypes)]
    : []),
  ...(input.userRanks?.length
    ? [inArray(dataBattleAction.userRank, input.userRanks)]
    : []),
  ...(input.minLevel !== undefined
    ? [gte(dataBattleAction.userLevel, input.minLevel)]
    : []),
  ...(input.maxLevel !== undefined
    ? [lte(dataBattleAction.userLevel, input.maxLevel)]
    : []),
];

/** Aggregate content usage without counting head-to-head outcome samples as content uses. */
export const selectBalanceContent = (
  client: Pick<DrizzleClient, "select">,
  input: BalanceFilters,
  periodStart = getBalancePeriodStart(),
) =>
  client
    .select({
      type: dataBattleAction.type,
      contentId: dataBattleAction.contentId,
      name: sql<string>`COALESCE(${jutsu.name}, ${item.name}, ${bloodline.name}, ${dataBattleAction.contentId})`,
      battleWon: dataBattleAction.battleWon,
      count: sum(dataBattleAction.count).mapWith(Number),
    })
    .from(dataBattleAction)
    .leftJoin(
      jutsu,
      and(eq(dataBattleAction.type, "jutsu"), eq(dataBattleAction.contentId, jutsu.id)),
    )
    .leftJoin(
      item,
      and(eq(dataBattleAction.type, "item"), eq(dataBattleAction.contentId, item.id)),
    )
    .leftJoin(
      bloodline,
      and(
        eq(dataBattleAction.type, "bloodline"),
        eq(dataBattleAction.contentId, bloodline.id),
      ),
    )
    .where(
      and(
        ...balanceConditions(input, periodStart),
        inArray(dataBattleAction.type, ["jutsu", "item", "bloodline"]),
      ),
    )
    .groupBy(
      dataBattleAction.type,
      dataBattleAction.contentId,
      jutsu.name,
      item.name,
      bloodline.name,
      dataBattleAction.battleWon,
    );

/** Count head-to-head outcomes once per settlement, split by starting order, level and rank. */
export const selectBalanceParticipants = (
  client: Pick<DrizzleClient, "select">,
  input: BalanceFilters,
  periodStart = getBalancePeriodStart(),
) =>
  client
    .select({
      userLevel: dataBattleAction.userLevel,
      userRank: dataBattleAction.userRank,
      turnOrder: dataBattleAction.turnOrder,
      battleWon: dataBattleAction.battleWon,
      count: sum(dataBattleAction.count).mapWith(Number),
    })
    .from(dataBattleAction)
    .where(
      and(
        ...balanceConditions(input, periodStart),
        eq(dataBattleAction.type, "participant"),
        inArray(dataBattleAction.turnOrder, [1, 2]),
      ),
    )
    .groupBy(
      dataBattleAction.userLevel,
      dataBattleAction.userRank,
      dataBattleAction.turnOrder,
      dataBattleAction.battleWon,
    );

/** Count settlements the activity filter kept out of the balance data, per reason. */
export const selectBalanceExclusions = (
  client: Pick<DrizzleClient, "select">,
  input: BalanceFilters,
  periodStart = getBalancePeriodStart(),
) =>
  client
    .select({
      contentId: dataBattleAction.contentId,
      count: sum(dataBattleAction.count).mapWith(Number),
    })
    .from(dataBattleAction)
    .where(
      and(
        ...balanceConditions(input, periodStart),
        eq(dataBattleAction.type, "participant"),
        inArray(dataBattleAction.contentId, Object.values(BALANCE_EXCLUSION_IDS)),
      ),
    )
    .groupBy(dataBattleAction.contentId);

/** List retained completed periods; the zero period contains undated legacy aggregates. */
export const selectBalanceArchives = (client: Pick<DrizzleClient, "selectDistinct">) =>
  client
    .selectDistinct({
      periodStart: dataBattleAction.periodStart,
    })
    .from(dataBattleAction)
    .where(lt(dataBattleAction.periodStart, getBalancePeriodStart()))
    .orderBy(desc(dataBattleAction.periodStart));

/** Read an archive in bounded primary-key pages, retaining identifiers even for deleted content. */
export const selectBalanceArchivePage = (
  client: Pick<DrizzleClient, "select">,
  periodStart: number,
  cursor: number,
) =>
  client
    .select()
    .from(dataBattleAction)
    .where(
      and(
        eq(dataBattleAction.periodStart, periodStart),
        gt(dataBattleAction.id, cursor),
      ),
    )
    .orderBy(asc(dataBattleAction.id))
    .limit(1000);

/**
 * Record a counted head-to-head battle once; both fighters settle it, so the second
 * settlement only fills in a winner the first one could not see (it fled or drew).
 */
export const upsertBalanceTurnOrder = (
  client: Pick<DrizzleClient, "insert">,
  row: Omit<DataBattleTurnOrder, "periodStart" | "createdAt">,
  periodStart = getBalancePeriodStart(),
) =>
  client
    .insert(dataBattleTurnOrder)
    .values({ ...row, periodStart })
    .onDuplicateKeyUpdate({
      set: {
        winner: sql`IF(${dataBattleTurnOrder.winner} = 0, ${row.winner ?? 0}, ${dataBattleTurnOrder.winner})`,
      },
    });

/** Move a participant's battle history; an empty replacement unlinks a deleted character. */
export const updateBalanceTurnOrderUserId = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  newUserId: string,
  column: "firstUserId" | "secondUserId",
) =>
  client
    .update(dataBattleTurnOrder)
    .set({ [column]: newUserId })
    .where(eq(dataBattleTurnOrder[column], userId));

/**
 * Count head-to-head battles by battle type and winning starting order. A battle counts
 * for rank and level filters only when both fighters match, so neither side's skill
 * bracket is compared against an unfiltered opponent.
 */
export const selectBalanceTurnOrderBattles = (
  client: Pick<DrizzleClient, "select">,
  input: BalanceFilters,
  periodStart = getBalancePeriodStart(),
) =>
  client
    .select({
      battleType: dataBattleTurnOrder.battleType,
      winner: dataBattleTurnOrder.winner,
      count: count().mapWith(Number),
    })
    .from(dataBattleTurnOrder)
    .where(
      and(
        eq(dataBattleTurnOrder.periodStart, periodStart),
        ...(input.battleTypes?.length
          ? [inArray(dataBattleTurnOrder.battleType, input.battleTypes)]
          : []),
        ...(input.userRanks?.length
          ? [
              inArray(dataBattleTurnOrder.firstRank, input.userRanks),
              inArray(dataBattleTurnOrder.secondRank, input.userRanks),
            ]
          : []),
        ...(input.minLevel !== undefined
          ? [
              gte(dataBattleTurnOrder.firstLevel, input.minLevel),
              gte(dataBattleTurnOrder.secondLevel, input.minLevel),
            ]
          : []),
        ...(input.maxLevel !== undefined
          ? [
              lte(dataBattleTurnOrder.firstLevel, input.maxLevel),
              lte(dataBattleTurnOrder.secondLevel, input.maxLevel),
            ]
          : []),
      ),
    )
    .groupBy(dataBattleTurnOrder.battleType, dataBattleTurnOrder.winner);

/** Count one player's recorded head-to-head battles by their starting order and the winner. */
export const selectPlayerTurnOrder = async (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) => {
  const byOrder = (turnOrder: 1 | 2) =>
    client
      .select({
        winner: dataBattleTurnOrder.winner,
        count: count().mapWith(Number),
      })
      .from(dataBattleTurnOrder)
      .where(
        eq(
          turnOrder === 1
            ? dataBattleTurnOrder.firstUserId
            : dataBattleTurnOrder.secondUserId,
          userId,
        ),
      )
      .groupBy(dataBattleTurnOrder.winner)
      .then((rows) => rows.map((row) => ({ ...row, turnOrder })));
  return (await Promise.all([byOrder(1), byOrder(2)])).flat();
};
