import { and, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import {
  FED_GOLD_BANK_INTEREST,
  FED_NORMAL_BANK_INTEREST,
  FED_SILVER_BANK_INTEREST,
  RYO_CAP,
} from "@/drizzle/constants";
import { dailyBankInterest, userData } from "@/drizzle/schema";
import { lockWithDailyTimer, updateGameSetting } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { chunkArray } from "@/utils/array";
import { calcBankInterest, getStrucBoost } from "@/utils/village";

const ENDPOINT_NAME = "daily-bank";
const INTEREST_INSERT_BATCH_SIZE = 500;

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check if we've already run today
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) {
    return new Response(`Please wait to next day - ${ENDPOINT_NAME}`);
  }

  try {
    // Get today's date
    const today = new Date().toISOString().split("T")[0] ?? "";

    // Query all villages with their structures
    const villages = await drizzleDB.query.village.findMany({
      with: { structures: true },
    });

    // Process each village
    const promises = villages.map(async (village: (typeof villages)[number]) => {
      // Calculations
      const boost = getStrucBoost("bankInterestPerLvl", village.structures);
      const baseFactor = calcBankInterest(boost) / 100;
      const factorNormal = baseFactor + FED_NORMAL_BANK_INTEREST / 100;
      const factorSilver = baseFactor + FED_SILVER_BANK_INTEREST / 100;
      const factorGold = baseFactor + FED_GOLD_BANK_INTEREST / 100;

      // Config for different user types
      const config = [
        {
          factor: baseFactor,
          where: and(
            eq(userData.federalStatus, "NONE"),
            eq(userData.staffAccount, false),
          ),
        },
        {
          factor: factorNormal,
          where: and(
            eq(userData.federalStatus, "NORMAL"),
            eq(userData.staffAccount, false),
          ),
        },
        {
          factor: factorSilver,
          where: and(
            eq(userData.federalStatus, "SILVER"),
            eq(userData.staffAccount, false),
          ),
        },
        {
          factor: factorGold,
          where: or(
            eq(userData.federalStatus, "GOLD"),
            ne(userData.staffAccount, false),
          ),
        },
      ];

      // Process each user type
      const typePromises = config.map(async (c) => {
        // Get users who have money in bank and haven't claimed today's interest
        const usersWithBank = await drizzleDB
          .select({
            userId: userData.userId,
            bank: userData.bank,
          })
          .from(userData)
          .where(
            and(
              eq(userData.villageId, village.id),
              gt(userData.bank, 0),
              lt(userData.bank, RYO_CAP),
              c.where,
            ),
          );

        // Create interest records for each user
        const interestRecords = usersWithBank.map(
          (user: (typeof usersWithBank)[number]) => {
            const interestAmount = Math.floor(Math.min(user.bank * c.factor, 1000000));
            return {
              id: nanoid(),
              userId: user.userId,
              amount: interestAmount,
              date: today,
              interestPercent: Math.floor(c.factor * 100),
            };
          },
        );

        // Insert interest records (upsert to handle duplicates)
        if (interestRecords.length > 0) {
          // A user/date row is an immutable snapshot. Earlier batches may
          // commit before a later batch fails, and retries re-read live bank
          // balances and membership tiers. Never overwrite a snapshot that was
          // already created (or even claimed) by an earlier attempt.
          for (const batch of chunkArray(interestRecords, INTEREST_INSERT_BATCH_SIZE)) {
            await drizzleDB
              .insert(dailyBankInterest)
              .values(batch)
              .onDuplicateKeyUpdate({
                set: {
                  id: sql`id`,
                },
              });
          }
        }

        return interestRecords.length;
      });

      const results = await Promise.all(typePromises);
      const totalProcessed = results.reduce(
        (sum: number, count: number) => sum + count,
        0,
      );

      return `${village.name}: ${totalProcessed} users processed`;
    });

    // Execute all village processing in parallel
    const responses = await Promise.all(promises);

    return new Response(
      `Daily bank interest processed successfully:\n${responses.join("\n")}`,
    );
  } catch (cause) {
    // Rollback timer on error
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    console.error(cause);
    return Response.json(
      { error: `Failed to process ${ENDPOINT_NAME}` },
      { status: 500 },
    );
  }
}
