import { NextResponse } from "next/server";
import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import { listAuctionListingForGET } from "@/queries/auction";
import {
  completeAuctionInternal,
  mergeDeliveredItems,
} from "@/server/api/routers/auction";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "auction-expire";
// Keep the persisted timer key stable across interval changes.
const TIMER_NAME = `${ENDPOINT_NAME}-0.083m`;

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check 5-minute timer lock to prevent abuse
  const response = await lockWithGameTimer(drizzleDB, TIMER_NAME, 5 * 60_000);
  if (response) return response;

  try {
    // Find auctions that are ACTIVE and have expired
    const now = new Date();
    const expiredAuctions = await listAuctionListingForGET(drizzleDB, now);

    if (expiredAuctions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No expired auctions to process",
      });
    }

    // Process all expired auctions in parallel
    const deliveries: Parameters<typeof mergeDeliveredItems>[1] = [];
    const results = await Promise.all(
      expiredAuctions.map(async (auction) => {
        try {
          const result = await completeAuctionInternal(drizzleDB, auction.id);
          if ("delivery" in result) deliveries.push(result.delivery);
          return {
            auctionId: auction.id,
            success: result.success,
            ...(result.success
              ? {
                  hadWinner: !!result.winningBid,
                  winnerId: result.winningBid?.bidderId ?? null,
                }
              : { error: result.message }),
          };
        } catch (error) {
          console.error(`Error processing auction ${auction.id}:`, error);
          return {
            auctionId: auction.id,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }),
    );

    // Settled items join their owners' stacks after every listing has settled.
    await mergeDeliveredItems(drizzleDB, deliveries);

    const successful = results.filter(
      (r: (typeof results)[number]) => r.success,
    ).length;
    const failed = results.filter((r: (typeof results)[number]) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Processed ${expiredAuctions.length} expired auctions: ${successful} successful, ${failed} failed`,
      processed: expiredAuctions.length,
      successful,
      failed,
      results: results,
    });
  } catch (error) {
    return await handleEndpointError(error);
  }
}
