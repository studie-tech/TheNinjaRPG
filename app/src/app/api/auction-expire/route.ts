import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { auctionListing } from "@/drizzle/schema";
import { handleEndpointError } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { completeAuctionInternal, fetchAuctionListing } from "@/server/api/routers/auction";

const ENDPOINT_NAME = "auction-expire";

export async function GET() {
  // disable cache for this server action
  await cookies();

  // No timer lock needed for 5-minute intervals

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

    // Process all expired auctions in parallel
    const results = await Promise.allSettled(
      expiredAuctions.map(async (auction) => {
        try {
          // Fetch the full auction data with bids
          const fullAuction = await fetchAuctionListing(drizzleDB, auction.id);
          if (!fullAuction) {
            console.error(`Could not fetch auction ${auction.id}`);
            return { auctionId: auction.id, success: false, error: "Auction not found" };
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
      })
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length;

    return NextResponse.json({
      success: true,
      message: `Processed ${expiredAuctions.length} expired auctions: ${successful} successful, ${failed} failed`,
      processed: expiredAuctions.length,
      successful,
      failed,
      results: results.map((r) => r.status === "fulfilled" ? r.value : { success: false, error: "Promise rejected" }),
    });
  } catch (error) {
    return handleEndpointError(error);
  }
}
