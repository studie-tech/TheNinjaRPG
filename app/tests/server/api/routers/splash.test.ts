import { afterEach, beforeEach, expect, it, vi } from "bun:test";
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
import { buildAuditSnapshot } from "@/libs/contentReview/snapshot";
import { ingestAgentSubmission } from "@/libs/contentReview/submit";
import * as splashQueries from "@/queries/splash";
import { contentReviewRouter } from "@/server/api/routers/contentReview";
import { splashRouter } from "@/server/api/routers/splash";
import type { AgentProposal } from "@/validators/contentReview";
import type { SplashInput } from "@/validators/splash";
import { insertUsers } from "../../../setup/factories";
import { splashEntry, splashInput } from "../../../setup/splash";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** One new editorial topic, with all required fields copied from a validated announcement. */
const agentDraft = (data: SplashInput): AgentProposal => ({
  title: "Announce the latest village feature",
  category: "NEW_CONTENT",
  rationale: "A verified village feature is ready for players to explore.",
  confidence: 95,
  usesUsageData: false,
  changes: [
    {
      entityType: "SPLASH",
      entityId: null,
      operation: "CREATE",
      set: Object.entries(data).map(([path, value]) => ({
        path,
        valueJson: JSON.stringify(value),
      })),
      media: [],
    },
  ],
  basis: [],
});

describeWithDatabase("structured welcome announcements", () => {
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
  afterEach(() => vi.restoreAllMocks());
  it("refuses player writes and never fabricates fallback entries", async () => {
    const player = await callerFor(splashRouter, "splash-player");
    expect((await player.get()).announcements).toEqual([]);
    expect((await player.create({ data: splashInput() })).success).toBe(false);
    expect(
      (await player.update({ id: "tower-dispatch", data: splashInput() })).success,
    ).toBe(false);
    expect(
      (await player.setEnabled({ id: "tower-dispatch", enabled: false })).success,
    ).toBe(false);
    await expect(player.getForEdit()).rejects.toThrow("Only content staff");
  });
  it("publishes up to ten entries independently, with priority and schedule boundaries", async () => {
    const db = await getTestDatabase();
    await db
      .insert(splashAnnouncement)
      .values(
        Array.from({ length: 12 }, (_, i) =>
          splashEntry({ id: `entry-${i}`, topicKey: `topic-${i}`, priority: i }),
        ),
      );
    const startsAt = new Date(Date.now() + 3_600_000);
    await db
      .insert(splashAnnouncement)
      .values(
        splashEntry({ id: "future", topicKey: "future", startsAt, priority: 100 }),
      );
    const player = await callerFor(splashRouter, "splash-player");
    const board = await player.get();
    expect(board.announcements.map((entry) => entry.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `entry-${11 - i}`),
    );
    expect(board.nextChangeAt).toEqual(startsAt);
    const editor = await callerFor(splashRouter, "splash-editor");
    expect((await editor.setEnabled({ id: "entry-11", enabled: false })).success).toBe(
      true,
    );
    expect((await player.get()).announcements.map((entry) => entry.id)).not.toContain(
      "entry-11",
    );
    expect((await player.get()).announcements).toHaveLength(10);
  });
  it("keeps disabled topics searchable and prevents duplicate recreation or topic renaming", async () => {
    const editor = await callerFor(splashRouter, "splash-editor");
    const created = await editor.create({ data: splashInput() });
    expect(created.success).toBe(true);
    const id = created.message;
    expect((await editor.setEnabled({ id, enabled: false })).success).toBe(true);
    expect((await editor.getForEdit({ search: "tower-defense" }))[0]).toMatchObject({
      id,
      enabled: false,
    });
    expect(
      (await editor.create({ data: splashInput({ name: "Different title" }) })).success,
    ).toBe(false);
    expect(
      (await editor.update({ id, data: splashInput({ topicKey: "another-topic" }) }))
        .success,
    ).toBe(false);
    expect(
      (await (await callerFor(splashRouter, "splash-player")).get()).announcements,
    ).toEqual([]);
    expect((await editor.setEnabled({ id, enabled: true })).success).toBe(true);
  });
  it("applies one reviewed entry, preserves its neighbors and outdates edits after disabling", async () => {
    const db = await getTestDatabase();
    await db.insert(splashAnnouncement).values([
      splashEntry(),
      splashEntry({
        id: "neighbor",
        topicKey: "another-topic",
        name: "Another topic",
      }),
    ]);
    const reviewer = await callerFor(contentReviewRouter, "splash-editor");
    const draft = {
      entityType: "SPLASH" as const,
      entityId: "tower-dispatch",
      category: "CONSISTENCY" as const,
      title: "Clarify the village announcement",
      rationale: "Explain the currently available village activity more clearly.",
      data: splashInput({ name: "News from Seichi" }),
    };
    expect((await reviewer.create(draft)).success).toBe(true);
    const pending = await db.query.contentProposal.findFirst();
    expect((await reviewer.approve({ id: pending!.id })).success).toBe(true);
    expect(
      (await (await callerFor(splashRouter, "splash-player")).get()).announcements
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["Another topic", "News from Seichi"]);
    expect(
      (
        await reviewer.create({
          ...draft,
          data: splashInput({ name: "Another edition" }),
        })
      ).success,
    ).toBe(true);
    await (await callerFor(splashRouter, "splash-editor")).setEnabled({
      id: "tower-dispatch",
      enabled: false,
    });
    expect(
      (await db.query.contentProposal.findMany()).map((row) => row.status).sort(),
    ).toEqual(["APPLIED", "OUTDATED"]);
  });
  it("provides disabled entries to the audit and refuses both archived updates and renamed duplicates", async () => {
    const db = await getTestDatabase();
    await db.insert(splashAnnouncement).values(splashEntry({ enabled: false }));
    const snapshot = await buildAuditSnapshot(db, "splash");
    expect(snapshot.splashCatalog?.[0]).toMatchObject({
      topicKey: "tower-defense",
      enabled: false,
    });
    expect(
      snapshot.entities.find((entry) => entry.id === "tower-dispatch")?.fields.enabled,
    ).toBe(false);
    const ref = { entityType: "SPLASH" as const, entityId: "tower-dispatch" };
    const live = (await loadEntities(db, [ref])).get(
      entityKey("SPLASH", ref.entityId),
    )!;
    const update: AgentProposal = {
      ...agentDraft(splashInput()),
      category: "CONSISTENCY",
      changes: [
        {
          entityType: "SPLASH",
          entityId: ref.entityId,
          operation: "UPDATE",
          set: [{ path: "enabled", valueJson: "true" }],
          media: [],
        },
      ],
      basis: [{ ...ref, v: live.version }],
    };
    const result = await ingestAgentSubmission(db, {
      agentName: "test",
      focus: "splash",
      proposals: [
        agentDraft(
          splashInput({ name: "Renamed old news", topicKey: " tower-defense " }),
        ),
        update,
      ],
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.refused).toHaveLength(2);
    expect(result.refused.map((entry) => entry.reason).join(" ")).toContain("disabled");
  });
  it("accepts new agent entries, prevents duplicate queued topics and archives reverted creations", async () => {
    const db = await getTestDatabase();
    const proposal = agentDraft(
      splashInput({ topicKey: "fresh-feature", name: "A fresh feature", image: "" }),
    );
    const result = await ingestAgentSubmission(db, {
      agentName: "test",
      focus: "splash",
      proposals: [
        proposal,
        {
          ...proposal,
          changes: [
            {
              ...proposal.changes[0]!,
              set: Object.entries(
                splashInput({ topicKey: " fresh-feature ", name: "Reworded feature" }),
              ).map(([path, value]) => ({ path, valueJson: JSON.stringify(value) })),
            },
          ],
        },
      ],
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.refused).toHaveLength(1);
    const reviewer = await callerFor(contentReviewRouter, "splash-editor");
    const id = result.accepted[0]!.id;
    expect(await reviewer.approve({ id })).toMatchObject({ success: true });
    expect(
      (await (await callerFor(splashRouter, "splash-player")).get()).announcements[0]
        ?.topicKey,
    ).toBe("fresh-feature");
    expect((await reviewer.revert({ id })).success).toBe(true);
    expect((await db.query.splashAnnouncement.findFirst())?.enabled).toBe(false);
  });
  it("removes incomplete creations when the audit log fails", async () => {
    const editor = await callerFor(splashRouter, "splash-editor");
    vi.spyOn(splashQueries, "logSplashUpdate").mockImplementationOnce(() => {
      throw new Error("Audit unavailable");
    });
    await expect(editor.create({ data: splashInput() })).rejects.toThrow(
      "Audit unavailable",
    );
    expect(await (await getTestDatabase()).query.splashAnnouncement.findMany()).toEqual(
      [],
    );
    expect((await editor.create({ data: splashInput() })).success).toBe(true);
  });
  it("cleans up failed multi-entry approvals so the same topic can be retried", async () => {
    const db = await getTestDatabase();
    const proposal = agentDraft(
      splashInput({ topicKey: "first-topic", name: "First topic" }),
    );
    proposal.changes.push(
      agentDraft(splashInput({ topicKey: "second-topic", name: "Second topic" }))
        .changes[0]!,
    );
    const submitted = await ingestAgentSubmission(db, {
      agentName: "test",
      focus: "splash",
      proposals: [proposal],
    });
    expect(submitted.accepted).toHaveLength(1);
    const id = submitted.accepted[0]!.id;
    const insert = splashQueries.insertSplashEntry;
    vi.spyOn(splashQueries, "insertSplashEntry").mockImplementation(
      (client, entryId, data) => {
        if (data.topicKey === "second-topic") throw new Error("Second insert failed");
        return insert(client, entryId, data);
      },
    );
    const reviewer = await callerFor(contentReviewRouter, "splash-editor");
    await expect(reviewer.approve({ id })).rejects.toThrow("Second insert failed");
    expect(await db.query.splashAnnouncement.findMany()).toEqual([]);
    expect((await db.query.contentProposal.findFirst())?.status).toBe("PENDING");
    vi.restoreAllMocks();
    expect(await reviewer.approve({ id })).toMatchObject({ success: true });
    expect(await db.query.splashAnnouncement.findMany()).toHaveLength(2);
  });
  it("restores archived creations when a later revert step fails", async () => {
    const db = await getTestDatabase();
    const proposal = agentDraft(
      splashInput({ topicKey: "first-topic", name: "First topic" }),
    );
    proposal.changes.push(
      agentDraft(splashInput({ topicKey: "second-topic", name: "Second topic" }))
        .changes[0]!,
    );
    const submitted = await ingestAgentSubmission(db, {
      agentName: "test",
      focus: "splash",
      proposals: [proposal],
    });
    const id = submitted.accepted[0]!.id;
    const reviewer = await callerFor(contentReviewRouter, "splash-editor");
    expect(await reviewer.approve({ id })).toMatchObject({ success: true });
    const log = splashQueries.logSplashUpdate;
    let writes = 0;
    vi.spyOn(splashQueries, "logSplashUpdate").mockImplementation((...args) => {
      if (++writes === 2) throw new Error("Second archive failed");
      return log(...args);
    });
    await expect(reviewer.revert({ id })).rejects.toThrow("Second archive failed");
    expect(
      (await db.query.splashAnnouncement.findMany()).every((row) => row.enabled),
    ).toBe(true);
    expect((await db.query.contentProposal.findFirst())?.status).toBe("APPLIED");
    vi.restoreAllMocks();
    expect(await reviewer.revert({ id })).toMatchObject({ success: true });
    expect(
      (await db.query.splashAnnouncement.findMany()).every((row) => !row.enabled),
    ).toBe(true);
  });
});
