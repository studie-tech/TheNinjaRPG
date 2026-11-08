import { createHmac } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import {
  createSupportTicketActivity,
  findSupportTicketForHandleIssueClosed,
  updateSupportTicketForHandleIssueClosed,
} from "@/queries/support";

import { drizzleDB } from "@/server/db";
import { constantTimeEquals } from "@/server/utils/constantTime";

/**
 * Handle GitHub webhook events
 */
export async function POST(request: NextRequest) {
  try {
    // Get the raw payload as received from GitHub
    const payload = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    // Verify webhook signature
    if (!webhookSecret) {
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 },
      );
    }
    if (!signature || !verifyGitHubSignature(payload, signature, webhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const data = JSON.parse(payload) as GitHubWebhookPayload;

    // Only handle issue events
    if (!data.issue) {
      return NextResponse.json({ message: "Not an issue event" }, { status: 200 });
    }

    // Handle issue closed event
    if (data.action === "closed") {
      await handleIssueClosed(data);
    }

    return NextResponse.json(
      { message: "Webhook processed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing GitHub webhook:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Handle when a GitHub issue is closed
 */
async function handleIssueClosed(data: GitHubWebhookPayload) {
  const issueUrl = data.issue.html_url;

  try {
    // Find the support ticket with this GitHub issue URL
    const ticket = await findSupportTicketForHandleIssueClosed(drizzleDB, issueUrl);

    if (!ticket) {
      console.log(`No support ticket found for GitHub issue: ${issueUrl}`);
      return;
    }

    // Only close if the ticket is not already resolved
    if (ticket.status === "RESOLVED") {
      console.log(`Support ticket ${ticket.id} is already resolved`);
      return;
    }

    // Update the support ticket status to resolved
    await Promise.all([
      updateSupportTicketForHandleIssueClosed(drizzleDB, ticket),

      // Create activity log for the closure
      // Use the ticket creator as the author since we don't have a system user
      createSupportTicketActivity(
        drizzleDB,
        ticket.id,
        ticket.createdByUserId,
        "STATUS_CHANGED",
        ticket.status,
        "RESOLVED",
        {
          source: "github_webhook",
          githubIssueUrl: issueUrl,
          githubIssueNumber: data.issue.number,
          closedAt: data.issue.closed_at,
        },
      ),
    ]);

    console.log(`Support ticket ${ticket.id} closed via GitHub webhook`);
  } catch (error) {
    console.error(`Error closing support ticket for GitHub issue ${issueUrl}:`, error);
  }
}

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  // Create HMAC with the secret
  const hmac = createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  const expectedSignature = `sha256=${hmac.digest("hex")}`;

  return constantTimeEquals(expectedSignature, signature);
}

// GitHub webhook payload types
interface GitHubWebhookPayload {
  action: string;
  issue: {
    number: number;
    html_url: string;
    state: string;
    closed_at: string | null;
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
}
