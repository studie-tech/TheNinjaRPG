import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { OPENAI_REVIEW_MODEL, TERR_BOT_ID } from "@/drizzle/constants";
import {
  handleEndpointError,
  lockWithMonthlyTimer,
  runClaimedCron,
} from "@/libs/gamesettings";
import { listUserDataForGET, listUserReviewForGET } from "@/queries/reports";
import { createConvo } from "@/routers/comments";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const TIMER_NAME = "timer-720h";

/**
 * Sends each staff member with written reviews an AI summary of the reviews they received
 * since the previous monthly run.
 */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  const timerCheck = await lockWithMonthlyTimer(drizzleDB, TIMER_NAME);

  return runClaimedCron(timerCheck, "/api/staffreview", async () => {
    const staff = await listUserDataForGET(drizzleDB);
    let hasAttemptedDelivery = false;

    const outcomes = await Promise.allSettled(
      staff.map(async (user) => {
        const results = await listUserReviewForGET(
          drizzleDB,
          timerCheck.prevTime,
          user,
        );
        if (!results.length) return;
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
        hasAttemptedDelivery = true;
        await createConvo({
          client: drizzleDB,
          authorUserId: TERR_BOT_ID,
          senderUserId: TERR_BOT_ID,
          receiverUserIds: [user.userId],
          title: `Staff Review: ${now.toLocaleString()}`,
          content: `Hey ${user.username}, here is a summary of your recent reviews from the past month. This is an auto-generated message, and everything has been written by an AI based on the reviews, in order to keep the original messages annonymized:
        <br /><br />${text.replace("```html", "").replace("```", "")}`,
          isStaffAvailable: false,
        });
      }),
    );

    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (!failure) return Response.json(`OK`);
    // Conversation writes can partially succeed even when createConvo rejects. Only
    // failures before any delivery attempt can safely release the month for a retry.
    if (!hasAttemptedDelivery) throw failure.reason;
    return handleEndpointError(failure.reason, { endpoint: "/api/staffreview" });
  });
}
