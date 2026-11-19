import { beforeEach, expect, it } from "bun:test";
import {
  actionLog,
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
  splashAnnouncement,
  userData,
} from "@/drizzle/schema";
import { entityKey, loadEntities } from "@/libs/contentReview/entities";
import { ingestAgentSubmission } from "@/libs/contentReview/submit";
import { DEFAULT_SPLASH, SPLASH_ID } from "@/libs/splash";
import { contentReviewRouter } from "@/server/api/routers/contentReview";
import { splashRouter } from "@/server/api/routers/splash";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("welcome board staff publishing and review", () => {
  beforeEach(async () => {
    await resetTables(
      contentProposalMedia,
      contentProposalBasis,
      contentProposalChange,
      contentProposal,
      splashAnnouncement,
      actionLog,
      userData,
    );
    await insertUsers([
      { userId: "splash-editor", role: "CONTENT-ADMIN" },
      { userId: "splash-player", role: "USER" },
    ]);
  });
  it("serves a useful default and refuses player edits", async () => {
    const player = await callerFor(splashRouter, "splash-player");
    expect((await player.get()).content).toEqual(DEFAULT_SPLASH);
    expect(
      (
        await player.update({
          id: SPLASH_ID,
          data: { ...DEFAULT_SPLASH, name: "Unauthorized" },
        })
      ).success,
    ).toBe(false);
    await expect(player.getForEdit()).rejects.toThrow("Only content staff");
    expect((await player.get()).content?.name).toBe(DEFAULT_SPLASH.name);
  });
  it("withholds scheduled text and exposes its next refresh boundary", async () => {
    const editor = await callerFor(splashRouter, "splash-editor");
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await editor.update({ id: SPLASH_ID, data: { ...DEFAULT_SPLASH, startsAt } }))
        .success,
    ).toBe(true);
    expect(await (await callerFor(splashRouter, "splash-player")).get()).toMatchObject({
      content: null,
      nextChangeAt: startsAt,
    });
    expect((await editor.getForEdit()).name).toBe(DEFAULT_SPLASH.name);
  });
  it("applies a proposed edition through the publishing procedure and outdates stale proposals", async () => {
    const db = await getTestDatabase();
    const reviewer = await callerFor(contentReviewRouter, "splash-editor");
    const draft = {
      entityType: "SPLASH" as const,
      entityId: SPLASH_ID,
      category: "CONSISTENCY" as const,
      title: "Refresh the welcome dispatch",
      rationale: "Highlight the currently available village activities.",
      data: { ...DEFAULT_SPLASH, name: "News from Seichi" },
    };
    expect((await reviewer.create(draft)).success).toBe(true);
    const pending = await db.query.contentProposal.findFirst();
    expect((await reviewer.approve({ id: pending!.id })).success).toBe(true);
    expect(
      (await (await callerFor(splashRouter, "splash-player")).get()).content?.name,
    ).toBe("News from Seichi");
    expect(await db.query.actionLog.findFirst()).toBeTruthy();
    expect(
      (
        await reviewer.create({
          ...draft,
          data: { ...DEFAULT_SPLASH, name: "Another edition" },
        })
      ).success,
    ).toBe(true);
    const editor = await callerFor(splashRouter, "splash-editor");
    await editor.update({
      id: SPLASH_ID,
      data: { ...DEFAULT_SPLASH, name: "Staff dispatch" },
    });
    expect(
      (await db.query.contentProposal.findMany()).map((row) => row.status).sort(),
    ).toEqual(["APPLIED", "OUTDATED"]);
  });
  it("refuses new welcome-board drafts from staff and automated reviewers", async () => {
    const reviewer = await callerFor(contentReviewRouter, "splash-editor");
    const created = await reviewer.create({
      entityType: "SPLASH",
      entityId: null,
      category: "NEW_CONTENT",
      title: "Create another welcome board",
      rationale: "Draft a second board for review by staff members.",
      data: DEFAULT_SPLASH,
    });
    expect(created.success).toBe(false);
    const db = await getTestDatabase();
    const ref = { entityType: "SPLASH" as const, entityId: SPLASH_ID };
    const live = (await loadEntities(db, [ref])).get(entityKey("SPLASH", SPLASH_ID))!;
    const result = await ingestAgentSubmission(db, {
      agentName: "test",
      focus: "splash",
      proposals: [
        {
          title: "Create another welcome board",
          category: "NEW_CONTENT",
          rationale: "Draft a second board for review by staff members.",
          confidence: 90,
          usesUsageData: false,
          changes: [
            {
              entityType: "SPLASH",
              entityId: null,
              operation: "CREATE",
              set: [{ path: "name", valueJson: '"Second board"' }],
              media: [],
            },
          ],
          basis: [{ ...ref, v: live.version }],
        },
      ],
    });
    expect(await db.query.contentProposal.findMany()).toHaveLength(0);
    expect(result).toBeTruthy();
  });
});
