import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env/server.mjs";
import { handleEndpointError } from "@/libs/gamesettings";
import { updateUserVoteForTopRankinGames } from "@/queries/profile";
import { drizzleDB } from "@/server/db";
import { periodStart } from "@/utils/time";

const voteSchema = z.object({
  game: z.literal("theninja-rpg"),
  site_vote_id: z.string().regex(/^\d{1,128}$/),
  token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  voted_at: z.number().int().nonnegative(),
  sent_at: z.number().int().nonnegative(),
});

/** Receive signed vote confirmations; never grant reputation directly from a callback. */
export async function POST(request: Request) {
  const secret = env.TOPRANKINGAMES_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json("Vote callback is not configured", { status: 503 });
  }

  try {
    const body = await request.text();
    const signature = request.headers.get("x-signature") ?? "";
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      return Response.json("Invalid signature", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json("Invalid vote payload", { status: 400 });
    }
    const vote = voteSchema.safeParse(payload);
    if (!vote.success) {
      return Response.json("Invalid vote payload", { status: 400 });
    }

    const now = new Date();
    const nowSeconds = now.getTime() / 1000;
    if (Math.abs(nowSeconds - vote.data.sent_at) > 300) {
      return Response.json("Expired callback", { status: 401 });
    }
    if (vote.data.token === "trg-test") return Response.json("OK");

    // Retries carry a fresh sent_at but retain voted_at. A prior day's vote must not
    // refill the flag after the daily cron clears it, even when the user did not claim.
    if (
      vote.data.voted_at < periodStart("daily", now).getTime() / 1000 ||
      vote.data.voted_at > nowSeconds + 300
    ) {
      return Response.json("INVALID");
    }

    await updateUserVoteForTopRankinGames(
      drizzleDB,
      vote.data.token,
      vote.data.site_vote_id,
      new Date(vote.data.voted_at * 1000),
    );
    return Response.json("OK");
  } catch (cause) {
    return await handleEndpointError(cause, {
      endpoint: "/api/webhooks/toprankingames",
    });
  }
}
