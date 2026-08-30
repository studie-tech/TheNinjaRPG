import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GITHUB_REPO_SLUG } from "@/drizzle/constants";
import { supportTicket } from "@/drizzle/schema";
import { isPullRequestPayload } from "@/libs/devContribution/jobs";
import {
  processContributionIssueEvent,
  processContributionPullRequestEvent,
} from "@/libs/devContribution/webhook";
import { createSupportTicketActivity } from "@/server/api/routers/support";
import { drizzleDB } from "@/server/db";

// GitHub webhook payload types
interface GitHubWebhookPayload {
  action: string;
  issue: {
    number: number;
    html_url: string;
    state: string;
    title?: string;
    body?: string | null;
    labels?: Array<{ name: string }>;
    user?: { login: string };
    closed_at: string | null;
    /** Present when this "issue" is really a pull request. */
    pull_request?: unknown;
  };
  pull_request?: {
    number: number;
    html_url: string;
    state: string;
    title?: string;
    body?: string | null;
    labels?: Array<{ name: string }>;
    user?: { login: string; type?: string };
    head?: {
      repo?: {
        name: string;
        owner?: { login: string };
      };
    };
    base?: {
      repo?: {
        name: string;
        owner?: { login: string };
      };
    };
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
}

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    console.log("Missing signature or secret");
    return false;
  }

  // Create HMAC with the secret
  const hmac = createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  const expectedSignature = `sha256=${hmac.digest("hex")}`;

  const actualSignature = signature;
  if (expectedSignature.length !== actualSignature.length) {
    console.log("Signature length mismatch");
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expectedSignature, "utf8"),
    Buffer.from(actualSignature, "utf8"),
  );
}

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
    const eventType = request.headers.get("x-github-event") ?? "unknown";

    // Jobs store only a ref number, and every lookup resolves it against the one
    // hardcoded repository, so events from any other repo sharing this webhook
    // would create jobs pointing at unrelated issues.
    const repoSlug =
      `${data.repository?.owner?.login ?? ""}/${data.repository?.name ?? ""}`.toLowerCase();
    const isContributionRepo = repoSlug === GITHUB_REPO_SLUG.toLowerCase();

    // Dev contribution job creation (issues + pull_request events).
    //
    // Kept off the support-ticket path: a failure here must not return 500,
    // because that both skips handleIssueClosed below and makes GitHub redeliver
    // the event, replaying the contribution processing.
    try {
      // GitHub fires `issues` for pull requests too, marking the payload with
      // issue.pull_request. Without this an opened or labeled PR also creates an
      // ISSUE_TRIAGE job that pays for a comment on it; the backfill already
      // skips the marker, so the two paths disagreed.
      if (
        isContributionRepo &&
        data.issue &&
        !isPullRequestPayload(data.issue) &&
        eventType === "issues"
      ) {
        await processContributionIssueEvent(drizzleDB, {
          number: data.issue.number,
          title: data.issue.title ?? `Issue #${data.issue.number}`,
          labels: (data.issue.labels ?? []).map((l) => l.name),
          body: data.issue.body,
          html_url: data.issue.html_url,
          state: data.issue.state,
          action: data.action,
          authorLogin: data.issue.user?.login,
        });
      }

      if (isContributionRepo && data.pull_request && eventType === "pull_request") {
        const headOwner = data.pull_request.head?.repo?.owner?.login?.toLowerCase();
        const baseOwner = data.pull_request.base?.repo?.owner?.login?.toLowerCase();
        await processContributionPullRequestEvent(drizzleDB, {
          number: data.pull_request.number,
          title: data.pull_request.title ?? `PR #${data.pull_request.number}`,
          labels: (data.pull_request.labels ?? []).map((l) => l.name),
          body: data.pull_request.body,
          html_url: data.pull_request.html_url,
          state: data.pull_request.state,
          action: data.action,
          authorLogin: data.pull_request.user?.login ?? "",
          authorIsBot: data.pull_request.user?.type === "Bot",
          isCrossFork: !!headOwner && !!baseOwner && headOwner !== baseOwner,
        });
      }
    } catch (error) {
      console.error("[github-webhook] dev-contribution processing failed:", error);
    }

    // Only handle issue events
    if (!data.issue) {
      return NextResponse.json({ message: "Not an issue event" }, { status: 200 });
    }

    // Handle issue closed event (support ticket sync)
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
    const ticket = await drizzleDB.query.supportTicket.findFirst({
      where: eq(supportTicket.githubIssueUrl, issueUrl),
    });

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
      drizzleDB
        .update(supportTicket)
        .set({
          status: "RESOLVED",
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(supportTicket.id, ticket.id)),

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
