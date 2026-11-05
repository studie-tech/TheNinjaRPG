import { gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ActiveBanStates } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  clearUserBanWithoutActiveReport,
  clearUserSilenceWithoutActiveReport,
  clearUserTradeBanWithoutActiveReport,
  listUserReportForGET,
  listUserReportForGET2,
  noActiveReportGuard,
} from "@/queries/reports";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-reports";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-reports", async () => {
    // Get all active bans, silences, and trade bans that have expired
    const expiredReports = await listUserReportForGET(drizzleDB);

    if (expiredReports.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No expired reports to process",
      });
    }

    // Group reports by user ID and type
    const userBanReports = new Map<string, boolean>();
    const userSilenceReports = new Map<string, boolean>();
    const userTradeBanReports = new Map<string, boolean>();

    // Track users who are currently banned, silenced, or trade banned
    const bannedUsers = new Map<string, boolean>();
    const silencedUsers = new Map<string, boolean>();
    const tradeBannedUsers = new Map<string, boolean>();

    for (const report of expiredReports) {
      if (!report.reportedUser?.userId) continue;

      const userId = report.reportedUser.userId;

      // Track if user is currently banned, silenced, or trade banned
      if (report.reportedUser.isBanned) {
        bannedUsers.set(userId, true);
      }

      if (report.reportedUser.isSilenced) {
        silencedUsers.set(userId, true);
      }

      if (report.reportedUser.isTradeBanned) {
        tradeBannedUsers.set(userId, true);
      }

      // Track which type of report is expiring
      if (ActiveBanStates.includes(report.status)) {
        userBanReports.set(userId, true);
      } else if (
        report.status === "SILENCE_ACTIVATED" ||
        report.status === "TIMEOUT_ACTIVATED"
      ) {
        userSilenceReports.set(userId, true);
      } else if (report.status === "TRADE_BAN_ACTIVATED") {
        userTradeBanReports.set(userId, true);
      }
    }

    // Get all active reports for these users in a single query
    const activeReports = await listUserReportForGET2(
      drizzleDB,
      bannedUsers,
      silencedUsers,
      tradeBannedUsers,
    );

    // Group active reports by user and type
    const userHasActiveBan = new Map<string, boolean>();
    const userHasActiveSilence = new Map<string, boolean>();
    const userHasActiveTradeBan = new Map<string, boolean>();

    for (const report of activeReports) {
      if (!report.reportedUserId) continue;

      if (ActiveBanStates.includes(report.status)) {
        userHasActiveBan.set(report.reportedUserId, true);
      } else if (
        report.status === "SILENCE_ACTIVATED" ||
        report.status === "TIMEOUT_ACTIVATED"
      ) {
        userHasActiveSilence.set(report.reportedUserId, true);
      } else if (report.status === "TRADE_BAN_ACTIVATED") {
        userHasActiveTradeBan.set(report.reportedUserId, true);
      }
    }

    // Determine which users need to be unbanned, unsilenced, or untrade banned
    const usersToUnban: string[] = [];
    const usersToUnsilence: string[] = [];
    const usersToUntradeBan: string[] = [];

    // For each banned user, check if they have any active ban reports
    for (const [userId] of bannedUsers) {
      // Only unban if they had an expired ban report and have no active ban reports
      if (userBanReports.has(userId) && !userHasActiveBan.has(userId)) {
        usersToUnban.push(userId);
      }
    }

    // For each silenced user, check if they have any active silence reports
    for (const [userId] of silencedUsers) {
      // Only unsilence if they had an expired silence report and have no active silence reports
      if (userSilenceReports.has(userId) && !userHasActiveSilence.has(userId)) {
        usersToUnsilence.push(userId);
      }
    }

    // For each trade banned user, check if they have any active trade ban reports
    for (const [userId] of tradeBannedUsers) {
      // Only untrade ban if they had an expired trade ban report and have no active trade ban reports
      if (userTradeBanReports.has(userId) && !userHasActiveTradeBan.has(userId)) {
        usersToUntradeBan.push(userId);
      }
    }

    console.log(
      `Users to unban: ${usersToUnban.length}, Users to unsilence: ${usersToUnsilence.length}, Users to untrade ban: ${usersToUntradeBan.length}`,
    );

    // Execute updates in batch if needed. A sanction issued after the reads above
    // keeps its flag through the guard.
    const updates = [];
    const noActiveReport = noActiveReportGuard(drizzleDB, userData.userId, gt);

    if (usersToUnban.length > 0) {
      updates.push(
        clearUserBanWithoutActiveReport(drizzleDB, usersToUnban, noActiveReport),
      );
    }

    if (usersToUnsilence.length > 0) {
      updates.push(
        clearUserSilenceWithoutActiveReport(
          drizzleDB,
          usersToUnsilence,
          noActiveReport,
        ),
      );
    }

    if (usersToUntradeBan.length > 0) {
      updates.push(
        clearUserTradeBanWithoutActiveReport(
          drizzleDB,
          usersToUntradeBan,
          noActiveReport,
        ),
      );
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${expiredReports.length} expired reports. Unbanned ${usersToUnban.length} users, unsilenced ${usersToUnsilence.length} users, and untrade banned ${usersToUntradeBan.length} users.`,
      details: {
        expiredReportsCount: expiredReports.length,
        activeReportsCount: activeReports.length,
        bannedUsersCount: bannedUsers.size,
        silencedUsersCount: silencedUsers.size,
        tradeBannedUsersCount: tradeBannedUsers.size,
        usersToUnbanCount: usersToUnban.length,
        usersToUnsilenceCount: usersToUnsilence.length,
        usersToUntradeBanCount: usersToUntradeBan.length,
        usersToUnban,
        usersToUnsilence,
        usersToUntradeBan,
      },
    });
  });
}
