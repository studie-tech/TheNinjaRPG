import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql, sum } from "drizzle-orm";
import {
  BALANCE_EXCLUSION_IDS,
  type BattleType,
  type UserRank,
} from "@/drizzle/constants";
import { bloodline, dataBattleAction, item, jutsu } from "@/drizzle/schema";
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
