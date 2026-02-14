import { and, eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auctionListing } from "@/drizzle/schema";
import {
  checkGameTimer,
  handleEndpointError,
  updateGameSetting,
} from "@/libs/gamesettings";
import {
  completeAuctionInternal,
  fetchAuctionListing,
} from "@/server/api/routers/auction";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "auction-expire";

export async function GET() {
  // disable cache for this server action
  await cookies();

  // Check 5-minute timer lock to prevent abuse
  const frequency = 0.083; // Using a decimal so it can work in minutes rather than hours
  const response = await checkGameTimer(drizzleDB, frequency, "m", ENDPOINT_NAME);
  if (response) return response;

  // Update timer
  await updateGameSetting(drizzleDB, `${ENDPOINT_NAME}-${frequency}m`, 0, new Date());

  try {
    // Find auctions that are ACTIVE and have expired
    const now = new Date();
    const expiredAuctions = await drizzleDB.query.auctionListing.findMany({
      where: and(
        eq(auctionListing.status, "ACTIVE"),
        lt(auctionListing.expiresAt, now),
      ),
    });

    if (expiredAuctions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No expired auctions to process",
      });
    }

    // Process all expired auctions in parallel
    const results = await Promise.all(
      expiredAuctions.map(async (auction) => {
        try {
          // Check if auction is still ACTIVE before processing
          const [currentAuction] = await drizzleDB
            .select()
            .from(auctionListing)
            .where(
              and(
                eq(auctionListing.id, auction.id),
                eq(auctionListing.status, "ACTIVE"),
              ),
            );

          // If auction is no longer ACTIVE, skip it (already processed)
          if (!currentAuction) {
            return {
              auctionId: auction.id,
              success: false,
              error: "Auction already processed",
            };
          }

          // Fetch the full auction data with bids
          const fullAuction = await fetchAuctionListing(drizzleDB, auction.id);
          if (!fullAuction) {
            console.error(`Could not fetch auction ${auction.id}`);
            return {
              auctionId: auction.id,
              success: false,
              error: "Auction not found",
            };
          }

          // Complete the auction
          const winningBid = await completeAuctionInternal(drizzleDB, fullAuction);

          return {
            auctionId: auction.id,
            success: true,
            hadWinner: !!winningBid,
            winnerId: winningBid?.bidderId || null,
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
