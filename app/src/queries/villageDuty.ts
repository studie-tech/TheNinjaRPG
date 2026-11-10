import { and, asc, count, eq, exists, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { VILLAGE_DUTY_RANKS, VILLAGE_DUTY_VISIBLE_LIMIT } from "@/drizzle/constants";
import { userData, village } from "@/drizzle/schema";
import { spriteUserRelations } from "@/queries/lpc";
import type { DrizzleClient } from "@/server/db";

/** Duty is tied to the membership tenure that enrolled, regardless of online presence. */
export const activeVillageDutyWhere = () =>
  and(
    isNotNull(userData.villageDutyVillageId),
    eq(userData.villageDutyVillageId, userData.villageId),
    gte(userData.villageDutyStartedAt, userData.joinedVillageAt),
    eq(userData.isAi, false),
    eq(userData.isBanned, false),
    eq(userData.isOutlaw, false),
    inArray(userData.rank, VILLAGE_DUTY_RANKS),
  );

/** Load the bounded town hall roster without private map appearance inputs. */
export const listVillageDutyRoster = (client: DrizzleClient, villageId: string) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      username: true,
      avatar: true,
      avatarLight: true,
      rank: true,
    },
    where: and(
      activeVillageDutyWhere(),
      inArray(
        userData.villageDutyVillageId,
        client
          .select({ id: village.id })
          .from(village)
          .where(and(eq(village.id, villageId), eq(village.type, "VILLAGE"))),
      ),
    ),
    orderBy: [asc(userData.villageDutyStartedAt), asc(userData.userId)],
    limit: VILLAGE_DUTY_VISIBLE_LIMIT,
  });

/** Load a bounded public patrol sample and the private inputs needed to resolve its appearance. */
export const listVillageDutyPatrols = (
  client: DrizzleClient,
  villageOrSector: string | number,
) =>
  client.query.userData.findMany({
    columns: {
      userId: true,
      username: true,
      avatar: true,
      avatarLight: true,
      gender: true,
      spriteBodyStyle: true,
      maxHealth: true,
      level: true,
      experience: true,
      rank: true,
      villageId: true,
      villageDutyStartedAt: true,
      anbuId: true,
    },
    with: { ...spriteUserRelations, anbuSquad: { columns: { image: true } } },
    where: and(
      activeVillageDutyWhere(),
      inArray(
        userData.villageDutyVillageId,
        client
          .select({ id: village.id })
          .from(village)
          .where(
            and(
              typeof villageOrSector === "number"
                ? eq(village.sector, villageOrSector)
                : eq(village.id, villageOrSector),
              eq(village.type, "VILLAGE"),
            ),
          ),
      ),
    ),
    orderBy: [asc(userData.villageDutyStartedAt), asc(userData.userId)],
    limit: VILLAGE_DUTY_VISIBLE_LIMIT,
  });

/** Count every eligible protector while keeping rendered appearance payloads bounded. */
export const countVillageDuty = (client: DrizzleClient, villageId: string) =>
  client
    .select({ count: count() })
    .from(userData)
    .where(and(activeVillageDutyWhere(), eq(userData.villageDutyVillageId, villageId)));

/** Select one enrolled defender per encounter so every protector can take a turn. */
export const findVillageDutyDefender = (client: DrizzleClient, sector: number) =>
  client.query.userData.findFirst({
    columns: { userId: true, villageId: true },
    where: and(
      activeVillageDutyWhere(),
      inArray(
        userData.villageDutyVillageId,
        client
          .select({ id: village.id })
          .from(village)
          .where(and(eq(village.sector, sector), eq(village.type, "VILLAGE"))),
      ),
    ),
    orderBy: sql`RAND()`,
  });

/** Enroll only an awake eligible member physically in their home village; never refresh activity. */
export const enrollVillageDuty = (
  client: DrizzleClient,
  userId: string,
  villageId: string,
  now: Date,
) =>
  client
    .update(userData)
    .set({ villageDutyVillageId: villageId, villageDutyStartedAt: now })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.villageId, villageId),
        eq(userData.status, "AWAKE"),
        eq(userData.location, "Village"),
        eq(userData.isBanned, false),
        eq(userData.isAi, false),
        eq(userData.isOutlaw, false),
        inArray(userData.rank, VILLAGE_DUTY_RANKS),
        exists(
          client
            .select({ one: sql`1` })
            .from(village)
            .where(
              and(
                eq(village.id, villageId),
                eq(village.type, "VILLAGE"),
                eq(village.sector, userData.sector),
              ),
            ),
        ),
      ),
    );

/** Cancellation is available during any activity and clears only the account's duty enrollment. */
export const cancelVillageDuty = (client: DrizzleClient, userId: string) =>
  client
    .update(userData)
    .set({ villageDutyVillageId: null, villageDutyStartedAt: null })
    .where(eq(userData.userId, userId));
