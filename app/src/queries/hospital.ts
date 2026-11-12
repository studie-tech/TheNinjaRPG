import { actionReadinessSqlSet } from "@/queries/actionReadiness";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
/**
 * Database access for hospital; authorization and transaction scopes stay in callers.
 */

import type { SQL } from "drizzle-orm";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  MEDNIN_EXP_CAP,
  MEDNIN_HEALABLE_STATES,
  REGEN_SECONDS,
  SENSEI_MAX_STUDENT_LEVEL,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { userData } from "@/drizzle/schema";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import { regenTicksSql, userRegenerationGainSql } from "@/server/utils/regeneration";
import { getNextUserSnapshotAt, secondsFromNow } from "@/utils/time";

/** Table alias for recipient joins, keeping its columns distinct from other participants. */
const recipient = alias(userData, "recipient");

/** Build the `userData` listing for `getHospitalizedUsers`, including predicates on `sector`, `villageId`, `status`. */
export const listUserDataForGetHospitalizedUsers = (
  client: Pick<DrizzleClient, "query">,
  user: { sector: number; villageId: null | string },
  uniqueVillageIds: string[],
) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      avatar: true,
      username: true,
      curHealth: true,
      maxHealth: true,
      regeneration: true,
      regenAt: true,
      level: true,
      status: true,
      sector: true,
      longitude: true,
      latitude: true,
      rank: true,
      isOutlaw: true,
    },
    where: and(
      eq(userData.sector, user.sector),
      user.villageId
        ? inArray(userData.villageId, uniqueVillageIds)
        : isNull(userData.villageId),
      or(...MEDNIN_HEALABLE_STATES.map((s) => eq(userData.status, s))),
      lt(userData.curHealth, userData.maxHealth),
      gte(userData.updatedAt, secondsFromNow(-36000)),
    ),
    limit: 10,
    orderBy: [asc(userData.updatedAt), asc(userData.userId)],
  });

/** Execute the database statement for `userHeal`. */
export const executeResultForUserHeal = (
  client: Pick<DrizzleClient, "execute">,
  t: Parameters<typeof userRegenerationGainSql>[0] &
    Pick<UserData, "userId" | "updatedAt" | "status" | "maxEnergy">,
  u: { updatedAt: Date; userId: string },
  healedAt: Date,
  expGain: number,
  chakraCost: number,
  questDataForDb: import("@/validators/objectives").QuestTrackerType[],
  pools: ("Health" | "Chakra" | "Stamina")[],
  toHeal: number,
  readiness?: ActionReadinessWrite,
) =>
  client.execute(sql`
            UPDATE ${userData}
            INNER JOIN ${userData} AS recipient ON ${recipient.userId} = ${t.userId}
            SET ${actionReadinessSqlSet(readiness, ["status", "curChakra"])} ${userData.status} = 'AWAKE', ${userData.updatedAt} = ${getNextUserSnapshotAt(u.updatedAt, healedAt)},
                ${userData.medicalExperience} = LEAST(${userData.medicalExperience} + ${expGain}, ${MEDNIN_EXP_CAP}),
                ${userData.curChakra} = ${readiness?.set.curChakra ?? userData.curChakra} - ${chakraCost},
                ${userData.questData} = CAST(${JSON.stringify(questDataForDb)} AS JSON),
                ${pools.includes("Health") ? sql`${recipient.curHealth} = LEAST(${recipient.curHealth} + ${toHeal}, ${recipient.maxHealth}),` : sql``}
                ${pools.includes("Chakra") ? sql`${recipient.curChakra} = LEAST(${recipient.curChakra} + ${toHeal}, ${recipient.maxChakra}),` : sql``}
                ${pools.includes("Stamina") ? sql`${recipient.curStamina} = LEAST(${recipient.curStamina} + ${toHeal}, ${recipient.maxStamina}),` : sql``}
                ${recipient.curEnergy} = LEAST(${t.maxEnergy}, ${recipient.curEnergy} + ${userRegenerationGainSql(t, recipient.regenAt, sql`NOW(3)`)}),
                ${recipient.maxEnergy} = ${t.maxEnergy},
                ${recipient.regenAt} = ${
                  t.status === "HOSPITALIZED"
                    ? sql`NOW(3)`
                    : sql`TIMESTAMPADD(SECOND, ${regenTicksSql(recipient.regenAt, sql`NOW(3)`)} * ${REGEN_SECONDS}, ${recipient.regenAt})`
                },
                ${recipient.updatedAt} = ${nextSnapshotSql(recipient.updatedAt)}
            WHERE ${and(
              eq(userData.userId, u.userId),
              eq(userData.updatedAt, u.updatedAt),
              readiness?.where ?? eq(userData.status, "AWAKE"),
              gte(userData.curChakra, chakraCost),
              eq(recipient.updatedAt, t.updatedAt),
              inArray(recipient.status, MEDNIN_HEALABLE_STATES),
            )}
          `);

/** Build the `userData` update for `userHeal`, setting `medicalExperience`, using predicates on `senseiId` and `level`. */
export const updateUserDataForUserHeal = (
  client: Pick<DrizzleClient, "update">,
  shareExp: number,
  u: { userId: string },
) =>
  client
    .update(userData)
    .set({
      medicalExperience: sql`LEAST(${userData.medicalExperience} + ${shareExp}, ${MEDNIN_EXP_CAP})`,
    })
    .where(
      and(
        eq(userData.senseiId, u.userId),
        lte(userData.level, SENSEI_MAX_STUDENT_LEVEL),
      ),
    );

/**
 * Build the `userData` update for `npcHeal`. A defined `cost` is charged and guarded on the
 * balance, even at zero; a free checkout leaves money out of the statement.
 */
export const updateUserDataForNpcHeal = (
  client: Pick<DrizzleClient, "update">,
  user: { maxHealth: number; maxEnergy: number },
  cost: number | undefined,
  energyRecovery: SQL<unknown>,
  healedAt: Date,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      curHealth: user.maxHealth,
      ...(cost === undefined ? {} : { money: sql`${userData.money} - ${cost}` }),
      curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${energyRecovery})`,
      maxEnergy: user.maxEnergy,
      regenAt: healedAt,
      updatedAt: nextSnapshotSql(userData.updatedAt),
      status: "AWAKE",
      warTornRespawn: false,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        cost === undefined ? undefined : gte(userData.money, cost),
        eq(userData.status, "HOSPITALIZED"),
      ),
    );
