import { NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { auctionListing } from "@/drizzle/schema";
import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { completeAuctionInternal, fetchAuctionListing } from "@/server/api/routers/auction";

const ENDPOINT_NAME = "auction-expire";

export async function GET() {
  // disable cache for this server action
  await cookies();

  // Check timer - 5 minutes
  const timerResponse = await lockWithGameTimer(drizzleDB, 5, "m", ENDPOINT_NAME);
  if (timerResponse) return timerResponse;

  try {
    // Find auctions that are ACTIVE and have expired
    const now = new Date();
    const expiredAuctions = await drizzleDB.query.auctionListing.findMany({
      where: and(
        eq(auctionListing.status, "ACTIVE"),
        lt(auctionListing.expiresAt, now)
      ),
    });

    if (expiredAuctions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No expired auctions to process",
      });
    }

    // Process expired auctions sequentially with row-level locking
    const results = [];
    for (const auction of expiredAuctions) {
      try {
        // Use transaction to prevent double-settlement
        const result = await drizzleDB.transaction(async (tx) => {
          // Check if auction is still ACTIVE before processing
          const [currentAuction] = await tx
            .select()
            .from(auctionListing)
            .where(and(eq(auctionListing.id, auction.id), eq(auctionListing.status, "ACTIVE")));

          // If auction is no longer ACTIVE, skip it (already processed)
          if (!currentAuction) {
            return { auctionId: auction.id, success: false, error: "Auction already processed" };
          }

          // Fetch the full auction data with bids
          const fullAuction = await fetchAuctionListing(tx, auction.id);
          if (!fullAuction) {
            console.error(`Could not fetch auction ${auction.id}`);
            return { auctionId: auction.id, success: false, error: "Auction not found" };
          }

          // Complete the auction within the transaction
          const winningBid = await completeAuctionInternal(tx, fullAuction);
          
          return {
            auctionId: auction.id,
            success: true,
            hadWinner: !!winningBid,
            winnerId: winningBid?.bidderId || null,
          };
        });

        results.push(result);
      } catch (error) {
        console.error(`Error processing auction ${auction.id}:`, error);
        results.push({
          auctionId: auction.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Processed ${expiredAuctions.length} expired auctions: ${successful} successful, ${failed} failed`,
      processed: expiredAuctions.length,
      successful,
      failed,
      results: results,
    });
  } catch (error) {
    return handleEndpointError(error);
  }
}
