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
import * as media from "@/libs/contentReview/media";
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

  it("returns the suggestions an undone approval outdated to the queue", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    await moderator.create({
      ...suggestion("Awarded for braveyr in battle."),
      title: "Rename the badge",
      data: { ...badgeRow(BADGE, "Awarded for braveyr in battle."), name: "Brave Heart" },
    });
    const first = (await proposalRows()).find(
      (row) => row.title === "Fix the badge description",
    );
    vi.spyOn(socials, "callDiscordContent").mockRejectedValue(new Error("Discord is down"));
    const editor = await callerFor(contentReviewRouter, EDITOR);
    await expect(editor.approve({ id: first?.id ?? "" })).rejects.toThrow(
      "Discord is down",
    );
    const rows = await proposalRows();
    expect(rows.map((row) => [row.title, row.status]).sort()).toEqual([
      ["Fix the badge description", "PENDING"],
      ["Rename the badge", "PENDING"],
    ]);
    expect(rows.every((row) => row.outdatedReason === null)).toBe(true);
  });

  it("undoes a revert that throws part way and keeps the suggestion applied", async () => {
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    await moderator.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const editor = await callerFor(contentReviewRouter, EDITOR);
    expect((await editor.approve({ id: pending?.id ?? "" })).success).toBe(true);
    vi.spyOn(socials, "callDiscordContent").mockRejectedValue(new Error("Discord is down"));
    await expect(editor.revert({ id: pending?.id ?? "" })).rejects.toThrow(
      "Discord is down",
    );
    const stored = await (await getTestDatabase()).query.badge.findFirst({
      where: eq(badge.id, BADGE),
    });
    expect(stored?.description).toBe("Awarded for bravery in battle.");
    expect((await proposalRows())[0]?.status).toBe("APPLIED");
  });

  it("records what the entity stored, so a trimmed value can still be reverted", async () => {
    const database = await getTestDatabase();
    const result = await ingestAgentSubmission(database, {
      agentName: "codex · test",
      runUrl: null,
      focus: "grammar",
      proposals: [
        {
          title: "Rename the badge",
          category: "CONSISTENCY",
          rationale: "The name should say what the badge is for.",
          confidence: 70,
          usesUsageData: false,
          changes: [
            {
              entityType: "BADGE",
              entityId: BADGE,
              operation: "UPDATE",
              set: [{ path: "name", valueJson: JSON.stringify("  Brave Heart  ") }],
              media: [],
            },
          ],
          basis: [{ entityType: "BADGE", entityId: BADGE, v: await versionOf(BADGE) }],
        },
      ],
    });
    const id = result.accepted[0]?.id ?? "";
    const editor = await callerFor(contentReviewRouter, EDITOR);
    expect((await editor.approve({ id })).success).toBe(true);
    expect((await proposalRows())[0]?.changes[0]?.applied).toEqual({ name: "Brave Heart" });
    expect((await editor.revert({ id })).success).toBe(true);
    const stored = await database.query.badge.findFirst({ where: eq(badge.id, BADGE) });
    expect(stored?.name).toBe(`Badge ${BADGE}`);
  });

  it("pages past suggestions a refresh outdated without skipping any", async () => {
    const database = await getTestDatabase();
    await database.insert(badge).values(badgeRow("review-badge-3", "Awarded for focus."));
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    for (const id of [BADGE, OTHER_BADGE, "review-badge-3"]) {
      await moderator.create({
        ...suggestion("A clearer description."),
        entityId: id,
        data: badgeRow(id, `Awarded for clarity ${id}.`),
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await database
      .update(badge)
      .set({ description: "Changed by a migration." })
      .where(eq(badge.id, BADGE));
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const first = await editor.getQueue({ status: "PENDING", limit: 2 });
    expect(first.items).toHaveLength(1);
    const second = await editor.getQueue({
      status: "PENDING",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect([...first.items, ...second.items].map((item) => item.targets[0]?.entityId)).toEqual(
      [OTHER_BADGE, "review-badge-3"],
    );
  });

  it("deletes the candidate files of a suggestion it refuses", async () => {
    vi.spyOn(media, "collectCandidates").mockResolvedValue([
      {
        source: "GENERATED",
        kind: "IMAGE",
        externalId: null,
        title: "Generated: a brave badge",
        url: "https://ui0arpl8sm.ufs.sh/f/generated-badge",
        fileKey: "generated-badge",
        lengthMs: null,
        prompt: "a brave badge",
      },
    ]);
    const removed = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    const result = await ingestAgentSubmission(await getTestDatabase(), {
      agentName: "codex · test",
      runUrl: null,
      focus: "visual",
      proposals: [
        {
          title: "Draw a new badge image",
          category: "VISUAL",
          rationale: "The badge uses a placeholder image.",
          confidence: 60,
          usesUsageData: false,
          changes: [
            {
              entityType: "BADGE",
              entityId: BADGE,
              operation: "UPDATE",
              set: [],
              media: [
                {
                  kind: "IMAGE",
                  path: "image",
                  catalogIds: [],
                  search: null,
                  generate: "a brave badge",
                },
              ],
            },
          ],
          basis: [{ entityType: "BADGE", entityId: BADGE, v: "0000000000000001" }],
        },
      ],
    });
    expect(result.refused[0]?.reason).toContain("changed after the snapshot");
    expect(removed).toHaveBeenCalledWith(["generated-badge"]);
  });

  it("deletes every planned upload when a later suggestion throws", async () => {
    const candidate = {
      source: "GENERATED" as const,
      kind: "IMAGE" as const,
      externalId: null,
      title: "Generated: a badge",
      url: "https://ui0arpl8sm.ufs.sh/f/first-upload",
      fileKey: "first-upload",
      lengthMs: null,
      prompt: "a badge",
    };
    vi.spyOn(media, "collectCandidates")
      .mockResolvedValueOnce([candidate])
      .mockRejectedValueOnce(new Error("Storage fell over"));
    const removed = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    const drawing = async (entityId: string) => ({
      title: `Draw a new image for ${entityId}`,
      category: "VISUAL" as const,
      rationale: "The badge uses a placeholder image.",
      confidence: 60,
      usesUsageData: false,
      changes: [
        {
          entityType: "BADGE" as const,
          entityId,
          operation: "UPDATE" as const,
          set: [],
          media: [
            {
              kind: "IMAGE" as const,
              path: "image",
              catalogIds: [],
              search: null,
              generate: "a badge",
            },
          ],
        },
      ],
      basis: [{ entityType: "BADGE" as const, entityId, v: await versionOf(entityId) }],
    });
    await expect(
      ingestAgentSubmission(await getTestDatabase(), {
        agentName: "codex · test",
        runUrl: null,
        focus: "visual",
        proposals: [await drawing(BADGE), await drawing(OTHER_BADGE)],
      }),
    ).rejects.toThrow("Storage fell over");
    expect(removed).toHaveBeenCalledWith(["first-upload"]);
    expect(await proposalRows()).toHaveLength(0);
  });

  it("saves a suggestion with all of its rows or none of them", async () => {
    vi.spyOn(media, "collectCandidates").mockResolvedValue([
      {
        source: "GENERATED",
        kind: "IMAGE",
        externalId: null,
        title: "x".repeat(400),
        url: "https://ui0arpl8sm.ufs.sh/f/too-long",
        fileKey: "too-long",
        lengthMs: null,
        prompt: "a badge",
      },
    ]);
    const removed = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    await expect(
      ingestAgentSubmission(await getTestDatabase(), {
        agentName: "codex · test",
        runUrl: null,
        focus: "visual",
        proposals: [
          {
            title: "Draw a new badge image",
            category: "VISUAL",
            rationale: "The badge uses a placeholder image.",
            confidence: 60,
            usesUsageData: false,
            changes: [
              {
                entityType: "BADGE",
                entityId: BADGE,
                operation: "UPDATE",
                set: [],
                media: [
                  {
                    kind: "IMAGE",
                    path: "image",
                    catalogIds: [],
                    search: null,
                    generate: "a badge",
                  },
                ],
              },
            ],
            basis: [{ entityType: "BADGE", entityId: BADGE, v: await versionOf(BADGE) }],
          },
        ],
      }),
    ).rejects.toThrow();
    expect(await proposalRows()).toHaveLength(0);
    expect(await (await getTestDatabase()).query.contentProposalChange.findMany()).toHaveLength(
      0,
    );
    expect(removed).toHaveBeenCalledWith(["too-long"]);
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

  it("refuses new content named like an existing entity or a draft in the queue", async () => {
    const database = await getTestDatabase();
    const draft = (name: string) => ({
      title: `New badge ${name}`,
      category: "NEW_CONTENT" as const,
      rationale: "Players have asked for a badge like this.",
      confidence: 70,
      usesUsageData: false,
      changes: [
        {
          entityType: "BADGE" as const,
          entityId: null,
          operation: "CREATE" as const,
          set: [
            { path: "name", valueJson: JSON.stringify(name) },
            { path: "image", valueJson: JSON.stringify(badgeRow(name, "").image) },
            { path: "description", valueJson: JSON.stringify("Awarded for resolve.") },
          ],
          media: [],
        },
      ],
      basis: [],
    });
    const submission: AgentSubmission = {
      agentName: "codex · test",
      runUrl: null,
      focus: "new_content",
      proposals: [draft(`BADGE ${BADGE.toUpperCase()}`), draft("Steadfast"), draft("steadfast ")],
    };
    const result = await ingestAgentSubmission(database, submission);
    expect(result.accepted.map((entry) => entry.index)).toEqual([1]);
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      expect.stringContaining("already exists or is waiting in the queue"),
      expect.stringContaining("already exists or is waiting in the queue"),
    ]);
    const nextDay = await ingestAgentSubmission(database, {
      ...submission,
      proposals: [draft("STEADFAST")],
    });
    expect(nextDay.accepted).toHaveLength(0);
    expect(nextDay.refused[0]?.reason).toContain("already exists or is waiting in the queue");
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
