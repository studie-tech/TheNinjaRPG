import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { OPENAI_REVIEW_MODEL, TERR_BOT_ID } from "@/drizzle/constants";
import { handleEndpointError, lockWithGameTimer } from "@/libs/gamesettings";
import { listUserDataForGET, listUserReviewForGET } from "@/queries/reports";
import { createConvo } from "@/routers/comments";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const TIMER_NAME = "timer-720h";

/** Sends each staff member an AI summary of the reviews they received in the last 30 days. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const frequency = 24 * 30;
  const response = await lockWithGameTimer(
    drizzleDB,
    TIMER_NAME,
    frequency * 60 * 60 * 1000,
  );
  if (response) return response;

  try {
    // Get all staff
    const staff = await listUserDataForGET(drizzleDB);

    // Summarize each staff member's reviews from the timer window (30 days)
    await Promise.all(
      staff.map(async (user) => {
        const results = await listUserReviewForGET(drizzleDB, frequency, user);
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
          content: `Hey ${user.username}, here is a summary of your recent reviews from the last 30 days. This is an auto-generated message, and everything has been written by an AI based on the reviews, in order to keep the original messages annonymized:
        <br /><br />${text.replace("```html", "").replace("```", "")}`,
          isStaffAvailable: false,
        });
      }),
    );

    return Response.json(`OK`);
  } catch (cause) {
    return handleEndpointError(cause, { endpoint: "/api/staffreview" });
  }
}
