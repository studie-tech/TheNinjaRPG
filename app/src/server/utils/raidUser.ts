import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Village membership for raid list filtering, plus owned sectors so exclusive
 * raids can be gated without a second hop. Avoids fetchUpdatedUser's fat row,
 * relations, regen writes, and quest bootstrap.
 */
export const fetchRaidListUser = async (client: DrizzleClient, userId: string) => {
  return client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { villageId: true },
    with: {
      village: {
        columns: { id: true },
        with: { sectors: { columns: { sector: true } } },
      },
    },
  });
};

/**
 * Fields required by joinRaidQueue guards (ban, AWAKE status, current sector,
 * village). Does not persist regen or rewrite quests — the later status CAS
 * and rollback pairing remain the source of truth for queue transitions.
 */
export const fetchRaidJoinUser = async (client: DrizzleClient, userId: string) => {
  return client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      villageId: true,
      sector: true,
      status: true,
      isBanned: true,
    },
  });
};
