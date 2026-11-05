import { type SQLWrapper, sql } from "drizzle-orm";
import { REGEN_SECONDS } from "@/drizzle/constants";
import type { UserData, UserTitle } from "@/drizzle/schema";
import {
  getTimedRegenerationGain,
  getTimedRegenerationPeriods,
  type TimedBuff,
} from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";

type RegenerationUser = Pick<UserData, "regenAt" | "regeneration"> & {
  regenerationWithoutTimedBuffs?: number;
  raidBuffs?: readonly TimedBuff[];
  titles?: readonly Pick<UserTitle, "effects" | "createdAt">[];
};

/** Recover complete pool ticks from the retained clock, including bonuses that have expired. */
export const getUserRegenerationGain = (user: RegenerationUser, at: Date) =>
  getTimedRegenerationGain(
    user.regenerationWithoutTimedBuffs ?? user.regeneration,
    regenerationBuffs(user),
    user.regenAt,
    Math.max(
      0,
      Math.floor((at.getTime() - user.regenAt.getTime()) / (REGEN_SECONDS * 1000)),
    ),
    REGEN_SECONDS,
  );

/** Whole regeneration ticks between two SQL instants. DIV keeps exact tick boundaries. */
export const regenTicksSql = (from: Date | SQLWrapper, at: Date | SQLWrapper) =>
  sql`(GREATEST(0, TIMESTAMPDIFF(MICROSECOND, ${from}, ${at})) DIV ${REGEN_SECONDS * 1_000_000})`;

/** Integrate the same discrete timed ticks against the live SQL clock, including concurrent resets. */
export const userRegenerationGainSql = (
  user: RegenerationUser,
  from: Date | SQLWrapper,
  at: Date | SQLWrapper,
) => {
  const base = user.regenerationWithoutTimedBuffs ?? user.regeneration;
  const step = REGEN_SECONDS * 1_000_000;
  const ticks = regenTicksSql(from, at);
  // Retain sub-tick precision before CEIL; MySQL division of integers otherwise
  // rounds to four decimal places and can move a millisecond boundary onto the prior tick.
  const boundaryTick = (boundary: number) =>
    sql`CEIL(TIMESTAMPDIFF(MICROSECOND, ${from}, ${new Date(boundary)}) * 1.000000 / ${step})`;
  const bonuses = getTimedRegenerationPeriods(base, regenerationBuffs(user)).map(
    ({ startsAt, endsAt, bonus }) =>
      sql`${bonus} * GREATEST(0, LEAST(${ticks} + 1, ${boundaryTick(endsAt)}) - GREATEST(1, ${boundaryTick(startsAt)}))`,
  );
  return sql`(${sql.join([sql`${base} * ${ticks}`, ...bonuses], sql` + `)})`;
};
