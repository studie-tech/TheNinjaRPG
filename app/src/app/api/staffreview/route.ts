import { openai } from "@ai-sdk/openai";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { generateText } from "ai";
import { and, eq, gt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { OPENAI_REVIEW_MODEL, TERR_BOT_ID } from "@/drizzle/constants";
import { userData, userReview } from "@/drizzle/schema";
import { checkGameTimer, updateGameSetting } from "@/libs/gamesettings";
import { createConvo } from "@/routers/comments";
import { drizzleDB } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

/**
 * DANGER ZONE
 * This function is responsible for the daily update of the game state.
 * It is a critical function that should be handled with care!!!
 * @returns
 */
export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const frequency = 24 * 30;
  const response = await checkGameTimer(drizzleDB, frequency);
  if (response) return response;

  // Update timer
  await updateGameSetting(drizzleDB, `timer-${frequency}h`, 0, new Date());

  try {
    // Get all staff
    const staff = await drizzleDB.query.userData.findMany({
      where: ne(userData.role, "USER"),
    });

    // Query all user review from the last 7 days
    await Promise.all(
      staff.map(async (user) => {
        const results = await drizzleDB.query.userReview.findMany({
          where: and(
            gt(userReview.createdAt, secondsFromNow(-frequency * 60 * 60)),
            ne(userReview.review, ""),
            eq(userReview.targetUserId, user.userId),
          ),
        });
        const allText = results.map((r) => r.review).join("\n");

        // Review
        const { text } = await generateText({
          model: openai(OPENAI_REVIEW_MODEL),
          prompt: `
          Write a succint version of the following staff reviews, preferably with actionable feedback for the staff in a listed format.
          Do not give feedback which can not be substantiated from the reviews.
          Do not give feedback relating to the hiring process.
          Split your feedback into three areas; strengths, areas for improvement, and actionable feedback
          Respond in valid html format with the following structure:

          <strong>Strengths:</strong>
          <ul>
            <li>...</li>
          </ul>
          etc.
          
          Reviews to give feedback from: ${allText}
        `,
        });

        // Create conversation
        const now = new Date();
        await createConvo({
          client: drizzleDB,
          authorUserId: TERR_BOT_ID,
          senderUserId: TERR_BOT_ID,
          receiverUserIds: [user.userId],
          title: `Staff Review: ${now.toLocaleString()}`,
          content: `Hey ${user.username}, here is a summary of your recent reviews from the last 7 days. This is an auto-generated message, and everything has been written by an AI based on the reviews, in order to keep the original messages annonymized:
        <br /><br />${text.replace("```html", "").replace("```", "")}`,
          isStaffAvailable: false,
        });
      }),
    );

    return Response.json(`OK`);
  } catch (cause) {
    console.error(cause);
    if (cause instanceof TRPCError) {
      // An error from tRPC occured
      const httpCode = getHTTPStatusCodeFromError(cause);
      return Response.json(cause, { status: httpCode });
    }
    // Another error occured
    return Response.json("Internal server error", { status: 500 });
  }
}
