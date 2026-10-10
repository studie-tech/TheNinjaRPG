
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  badge,
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
} from "@/drizzle/schema";
import { POST } from "@/app/api/content-review/proposals/route";
import { GET } from "@/app/api/content-review/snapshot/route";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const SECRET = "test-content-review-secret";
const originalSecret = process.env.CRON_SECRET;

const snapshotRequest = (auth?: string, focus = "grammar") =>
  new Request(`https://example.com/api/content-review/snapshot?focus=${focus}`, {
    headers: auth ? { authorization: auth } : {},
  });

const submitRequest = (auth: string | undefined, body: string) =>
  new Request("https://example.com/api/content-review/proposals", {
    method: "POST",
    headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" },
    body,
  });

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  process.env.CRON_SECRET = originalSecret;
});

describe("content review routes authenticate like the crons", () => {
  it("refuse requests without the cron secret", async () => {
    expect((await GET(snapshotRequest())).status).toBe(401);
    expect((await GET(snapshotRequest("Bearer wrong"))).status).toBe(401);
    expect((await POST(submitRequest(undefined, "{}"))).status).toBe(401);
  });

  it("refuse malformed submissions before touching the database", async () => {
    const auth = `Bearer ${SECRET}`;
    expect((await POST(submitRequest(auth, "not json"))).status).toBe(400);
    expect((await POST(submitRequest(auth, JSON.stringify({ proposals: 1 })))).status).toBe(
      400,
    );
    expect((await GET(snapshotRequest(auth, "everything"))).status).toBe(400);
  });
});

describeWithDatabase("content review routes end to end", () => {
  beforeEach(async () => {
    await resetTables(
      badge,
      contentProposal,
      contentProposalBasis,
      contentProposalChange,
      contentProposalMedia,
    );
    await (await getTestDatabase()).insert(badge).values({
      id: "route-badge",
      name: "Route Badge",
      image: "https://ui0arpl8sm.ufs.sh/f/badge.webp",
      description: "Given for braveyr.",
    });
  });

  it("serves a snapshot whose versions a submission can cite", async () => {
    const auth = `Bearer ${SECRET}`;
    const response = await GET(snapshotRequest(auth));
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as {
      focus: string;
      proposalSchema: object;
      entities: { type: string; id: string; v: string; fields: Record<string, unknown> }[];
    };
    expect(snapshot.focus).toBe("grammar");
    expect(snapshot.proposalSchema).toHaveProperty("properties.proposals");
    const entity = snapshot.entities.find((row) => row.id === "route-badge");
    expect(entity?.fields.description).toBe("Given for braveyr.");

    const submitted = await POST(
      submitRequest(
        auth,
        JSON.stringify({
          agentName: "codex · route test",
          focus: "grammar",
          proposals: [
            {
              title: "Fix the spelling of bravery",
              category: "GRAMMAR",
              rationale: "The description misspells bravery.",
              confidence: 95,
              usesUsageData: false,
              changes: [
                {
                  entityType: "BADGE",
                  entityId: "route-badge",
                  operation: "UPDATE",
                  set: [{ path: "description", valueJson: '"Given for bravery."' }],
                  media: [],
                },
              ],
              basis: [{ entityType: "BADGE", entityId: "route-badge", v: entity?.v }],
            },
          ],
        }),
      ),
    );
    expect(submitted.status).toBe(200);
    const result = (await submitted.json()) as {
      accepted: unknown[];
      refused: unknown[];
      summary: string;
    };
    expect(result.accepted).toHaveLength(1);
    expect(result.refused).toHaveLength(0);
    expect(result.summary).toContain("Accepted 1 of 1");
  });
});
