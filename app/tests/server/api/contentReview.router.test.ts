// @vitest-environment node

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTENT_AUDIT_DAILY_LIMIT } from "@/drizzle/constants";
import {
  actionLog,
  badge,
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
  gameAsset,
  userData,
} from "@/drizzle/schema";
import { cleanupContentProposals } from "@/libs/contentReview/cleanup";
import { entityKey, loadEntities } from "@/libs/contentReview/entities";
import { epidemicAssetId, importEpidemicSfx } from "@/libs/contentReview/media";
import { ingestAgentSubmission } from "@/libs/contentReview/submit";
import * as socials from "@/libs/socials";
import { badgeRouter } from "@/server/api/routers/badge";
import { contentReviewRouter } from "@/server/api/routers/contentReview";
import type { AgentSubmission } from "@/validators/contentReview";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const EDITOR = "review-editor";
const MODERATOR = "review-moderator";
const PLAYER = "review-player";
const BADGE = "review-badge";
const OTHER_BADGE = "review-badge-2";

const badgeRow = (id: string, description: string) => ({
  id,
  name: `Badge ${id}`,
  image: "https://ui0arpl8sm.ufs.sh/f/badge.webp",
  description,
});

const suggestion = (description: string) => ({
  entityType: "BADGE" as const,
  entityId: BADGE,
  category: "GRAMMAR" as const,
  title: "Fix the badge description",
  rationale: "The description has a spelling error.",
  data: { ...badgeRow(BADGE, description) },
});

const versionOf = async (id: string) => {
  const entities = await loadEntities(await getTestDatabase(), [
    { entityType: "BADGE", entityId: id },
  ]);
  return entities.get(entityKey("BADGE", id))?.version ?? "";
};

const proposalRows = async () =>
  (await getTestDatabase()).query.contentProposal.findMany({
    with: { changes: true, basis: true },
  });

describeWithDatabase("content review", () => {
  beforeEach(async () => {
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await resetTables(
      contentProposal,
      contentProposalChange,
      contentProposalBasis,
      contentProposalMedia,
      actionLog,
      badge,
      gameAsset,
      userData,
    );
    await insertUsers([
      { userId: EDITOR, username: "ReviewEditor", role: "CONTENT-ADMIN" },
      { userId: MODERATOR, username: "ReviewModerator", role: "MODERATOR" },
      { userId: PLAYER, username: "ReviewPlayer", role: "USER" },
    ]);
    const database = await getTestDatabase();
    await database
      .insert(badge)
      .values([
        badgeRow(BADGE, "Awarded for braveyr in battle."),
        badgeRow(OTHER_BADGE, "Awarded for patience."),
      ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores only the changed fields of a staff suggestion", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    const result = await moderator.create(suggestion("Awarded for bravery in battle."));
    expect(result.success).toBe(true);
    const [row] = await proposalRows();
    expect(row?.status).toBe("PENDING");
    expect(row?.source).toBe("STAFF");
    expect(row?.changes[0]?.before).toEqual({ description: "Awarded for braveyr in battle." });
    expect(row?.changes[0]?.after).toEqual({ description: "Awarded for bravery in battle." });
    expect(row?.basis[0]?.version).toBe(await versionOf(BADGE));
    const player = await callerFor(contentReviewRouter, PLAYER);
    expect((await player.create(suggestion("Something else entirely."))).success).toBe(false);
  });

  it("leaves out form values the validator would store as the live value", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    const input = suggestion("Awarded for bravery in battle.");
    await moderator.create({ ...input, data: { ...input.data, name: ` ${input.data.name} ` } });
    const [row] = await proposalRows();
    expect(row?.changes[0]?.after).toEqual({ description: "Awarded for bravery in battle." });
  });

  it("applies an approval through the badge's own update and can revert it", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const editor = await callerFor(contentReviewRouter, EDITOR);

    const denied = await moderator.approve({ id: pending?.id ?? "" });
    expect(denied.success).toBe(false);

    const approved = await editor.approve({ id: pending?.id ?? "" });
    expect(approved).toMatchObject({ success: true });
    const database = await getTestDatabase();
    const stored = await database.query.badge.findFirst({ where: eq(badge.id, BADGE) });
    expect(stored?.description).toBe("Awarded for bravery in battle.");
    const [applied] = await proposalRows();
    expect(applied?.status).toBe("APPLIED");
    expect(applied?.reviewedByUserId).toBe(EDITOR);
    expect(applied?.changes[0]?.applied).toEqual({
      description: "Awarded for bravery in battle.",
    });
    const logs = await database.query.actionLog.findMany({
      where: eq(actionLog.relatedId, BADGE),
    });
    expect(logs.some((log) => log.tableName === "badge")).toBe(true);

    const reverted = await editor.revert({ id: pending?.id ?? "" });
    expect(reverted.success).toBe(true);
    const restored = await database.query.badge.findFirst({ where: eq(badge.id, BADGE) });
    expect(restored?.description).toBe("Awarded for braveyr in battle.");
    expect((await proposalRows())[0]?.status).toBe("REVERTED");
  });

  it("undoes an approval that throws part way and keeps the suggestion pending", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    // The badge update writes its row, then fails posting to Discord.
    vi.spyOn(socials, "callDiscordContent").mockRejectedValue(new Error("Discord is down"));
    const editor = await callerFor(contentReviewRouter, EDITOR);
    await expect(editor.approve({ id: pending?.id ?? "" })).rejects.toThrow(
      "Discord is down",
    );
    const stored = await (await getTestDatabase()).query.badge.findFirst({
      where: eq(badge.id, BADGE),
    });
    expect(stored?.description).toBe("Awarded for braveyr in battle.");
    expect((await proposalRows())[0]?.status).toBe("PENDING");
  });

  it("applies reviewer edits and leaves out unticked fields", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create({
      ...suggestion("Awarded for bravery in battle."),
      data: { ...badgeRow(BADGE, "Awarded for bravery in battle."), name: "Brave Heart" },
    });
    const [pending] = await proposalRows();
    const changeId = pending?.changes[0]?.id ?? "";
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const approved = await editor.approve({
      id: pending?.id ?? "",
      exclude: [{ changeId, field: "name" }],
      edits: [{ changeId, field: "description", value: "Awarded for bravery." }],
    });
    expect(approved.success).toBe(true);
    const stored = await (await getTestDatabase()).query.badge.findFirst({
      where: eq(badge.id, BADGE),
    });
    expect(stored?.name).toBe(`Badge ${BADGE}`);
    expect(stored?.description).toBe("Awarded for bravery.");
  });

  it("outdates a pending suggestion as soon as its target is edited", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const badges = await callerFor(badgeRouter, EDITOR);
    await badges.update({
      id: BADGE,
      data: { ...badgeRow(BADGE, "Rewritten by hand."), image: badgeRow(BADGE, "").image },
    });
    const [outdated] = await proposalRows();
    expect(outdated?.status).toBe("OUTDATED");
    expect(outdated?.outdatedReason).toContain("edited by ReviewEditor");
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const approved = await editor.approve({ id: pending?.id ?? "" });
    expect(approved.success).toBe(false);
  });

  it("keeps a pending suggestion when an editor saves without changes", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    const badges = await callerFor(badgeRouter, EDITOR);
    await badges.update({ id: BADGE, data: badgeRow(BADGE, "Awarded for braveyr in battle.") });
    expect((await proposalRows())[0]?.status).toBe("PENDING");
  });

  it("catches edits that bypassed the editors when the queue is read", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    await (await getTestDatabase())
      .update(badge)
      .set({ description: "Changed by a migration." })
      .where(eq(badge.id, BADGE));
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const queue = await editor.getQueue({ status: "PENDING", limit: 25 });
    expect(queue.items).toHaveLength(0);
    const [row] = await proposalRows();
    expect(row?.status).toBe("OUTDATED");
    expect(row?.outdatedReason).toContain("changed since the suggestion was made");
  });

  it("lets exactly one of two simultaneous approvals win", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const results = await Promise.all([
      editor.approve({ id: pending?.id ?? "" }),
      editor.approve({ id: pending?.id ?? "" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
  });

  it("refuses stale, duplicate and invalid audit suggestions and caps the day", async () => {
    const database = await getTestDatabase();
    const version = await versionOf(BADGE);
    const proposal = (entityId: string, v: string, path = "description") => ({
      title: "Fix the badge description",
      category: "GRAMMAR" as const,
      rationale: "The description has a spelling error.",
      confidence: 80,
      usesUsageData: false,
      changes: [
        {
          entityType: "BADGE" as const,
          entityId,
          operation: "UPDATE" as const,
          set: [{ path, valueJson: JSON.stringify("Awarded for bravery in battle.") }],
          media: [],
        },
      ],
      basis: [{ entityType: "BADGE" as const, entityId, v }],
    });
    const submission: AgentSubmission = {
      agentName: "codex · test",
      runUrl: null,
      focus: "grammar",
      proposals: [
        proposal(BADGE, version),
        proposal(BADGE, version),
        proposal(OTHER_BADGE, "0000000000000001"),
        proposal(OTHER_BADGE, await versionOf(OTHER_BADGE), "createdAt"),
      ],
    };
    const result = await ingestAgentSubmission(database, submission);
    expect(result.accepted.map((entry) => entry.index)).toEqual([0]);
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      expect.stringContaining("already targets"),
      expect.stringContaining("changed after the snapshot"),
      expect.stringContaining("no editable field"),
    ]);
    const [stored] = await proposalRows();
    expect(stored?.source).toBe("AGENT");
    expect(stored?.agentName).toBe("codex · test");
    expect(stored?.changes[0]?.before).toEqual({ description: "Awarded for braveyr in battle." });

    await database.insert(contentProposal).values(
      Array.from({ length: CONTENT_AUDIT_DAILY_LIMIT }, (_, index) => ({
        id: `earlier-${index}`,
        title: "Earlier suggestion",
        rationale: "Added earlier today.",
        category: "GRAMMAR" as const,
        source: "AGENT" as const,
        status: "REJECTED" as const,
      })),
    );
    const capped = await ingestAgentSubmission(database, {
      ...submission,
      proposals: [proposal(OTHER_BADGE, await versionOf(OTHER_BADGE))],
    });
    expect(capped.accepted).toHaveLength(0);
    expect(capped.refused[0]?.reason).toContain("limit is reached");
  });

  it("reuses an Epidemic sound the asset library already holds", async () => {
    const database = await getTestDatabase();
    const id = epidemicAssetId("7c9ac26f-3c04-4fbd-8a70-049cd775c094");
    await database.insert(gameAsset).values({
      id,
      name: "Water, Splash",
      type: "SFX",
      image: "https://ui0arpl8sm.ufs.sh/f/sfx.webp",
      url: "https://ui0arpl8sm.ufs.sh/f/water.mp3",
      licenseDetails: "Epidemic Sound",
    });
    const result = await importEpidemicSfx(database, EDITOR, {
      epidemicId: "7c9ac26f-3c04-4fbd-8a70-049cd775c094",
      title: "Water, Splash",
    });
    expect(result.created).toBe(false);
    expect(result.asset.id).toBe(id);
    expect(await database.query.gameAsset.findMany()).toHaveLength(1);
  });

  it("removes rejected suggestions once the retention window has passed", async () => {
    const database = await getTestDatabase();
    const old = new Date(Date.now() - 11 * 86_400_000);
    await database.insert(contentProposal).values([
      {
        id: "old-rejected",
        title: "Old",
        rationale: "Rejected long ago.",
        category: "GRAMMAR",
        source: "AGENT",
        status: "REJECTED",
        statusChangedAt: old,
      },
      {
        id: "recent-rejected",
        title: "Recent",
        rationale: "Rejected yesterday.",
        category: "GRAMMAR",
        source: "AGENT",
        status: "REJECTED",
      },
    ]);
    await database.insert(contentProposalChange).values({
      id: "old-change",
      proposalId: "old-rejected",
      entityType: "BADGE",
      entityId: BADGE,
      before: {},
      after: { description: "x" },
    });
    const result = await cleanupContentProposals(database);
    expect(result.removed).toBe(1);
    const remaining = await proposalRows();
    expect(remaining.map((row) => row.id)).toEqual(["recent-rejected"]);
    expect(await database.query.contentProposalChange.findMany()).toHaveLength(0);
  });
});
