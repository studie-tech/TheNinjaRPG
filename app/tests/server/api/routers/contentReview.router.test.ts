import { readAgentProposal } from "@/queries/contentReview";

import { CONTENT_PROPOSAL_RETENTION_DAYS } from "@/drizzle/constants";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  actionLog,
  badge,
  bloodline,
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
  gameAsset,
  item,
  quest,
  userData,
} from "@/drizzle/schema";
import { cleanupContentProposals } from "@/libs/contentReview/cleanup";
import { entityKey, loadEntities } from "@/libs/contentReview/entities";
import { refreshProposalFreshness } from "@/libs/contentReview/outdate";
import * as media from "@/libs/contentReview/media";
import { epidemicAssetId, importEpidemicSfx } from "@/libs/contentReview/media";

import { ingestAgentSubmission, reviseAgentProposal } from "@/libs/contentReview/submit";
import * as socials from "@/libs/socials";
import { badgeRouter } from "@/server/api/routers/badge";
import { contentReviewRouter } from "@/server/api/routers/contentReview";
import { profileRouter } from "@/server/api/routers/profile";
import type { AgentSubmission } from "@/validators/contentReview";
import { insertItems, insertQuests, insertUsers } from "../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const EDITOR = "review-editor";
const MODERATOR = "review-moderator";
const AUTHOR = "review-author";
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
      bloodline,
      gameAsset,
      item,
      quest,
      userData,
    );
    await insertUsers([
      { userId: EDITOR, username: "ReviewEditor", role: "CONTENT-ADMIN" },
      { userId: MODERATOR, username: "ReviewModerator", role: "MODERATOR" },
      { userId: AUTHOR, username: "ReviewAuthor", role: "HEAD_CONTENT" },
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

  it.each(["approve", "bulkApprove"] as const)("changes the reviewer's equipped lineage and derived regeneration through %s and revert", async (action) => {
    const database = await getTestDatabase();
    const ref = { entityType: "BLOODLINE" as const, entityId: "review-lineage" };
    await database.insert(bloodline).values({ id: ref.entityId, name: "Review Lineage", rank: "A", image: "/bloodline.png", description: "A lineage.", regenIncrease: 10, effects: [] });
    await database.update(userData).set({ bloodlineId: ref.entityId, regeneration: 10, status: "AWAKE", rank: "JONIN", level: 50, isOutlaw: true, primaryElement: "Fire", secondaryElement: "Water" }).where(eq(userData.userId, EDITOR));
    const entity = (await loadEntities(database, [ref])).get(entityKey(ref.entityType, ref.entityId));
    expect((await (await callerFor(contentReviewRouter, AUTHOR)).create({ ...ref, category: "BALANCE", title: "Adjust lineage regeneration", rationale: "Adjust the passive regeneration bonus.", data: { ...entity?.payload, regenIncrease: 40 } })).success).toBe(true);
    const id = (await proposalRows())[0]!.id;
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    const profile = await callerFor(profileRouter, EDITOR);
    expect((await profile.getUser()).userData).toMatchObject({ bloodline: { regenIncrease: 10 }, regeneration: 20 });
    expect((await (action === "approve" ? reviewer.approve({ id }) : reviewer.bulkApprove({ ids: [id] }))).success).toBe(true);
    expect((await profile.getUser()).userData).toMatchObject({ bloodline: { regenIncrease: 40 }, regeneration: 50 });
    expect((await reviewer.revert({ id })).success).toBe(true);
    expect((await profile.getUser()).userData).toMatchObject({ bloodline: { regenIncrease: 10 }, regeneration: 20 });
  });

  const revisionProposal = async (description = "Awarded for bravery in battle.") => ({
    title: "Clarify the badge award",
    category: "GRAMMAR" as const,
    rationale: "Clarify the award with accurate wording.",
    confidence: 90,
    usesUsageData: false,
    changes: [{ entityType: "BADGE" as const, entityId: BADGE, operation: "UPDATE" as const,
      set: [{ path: "description", valueJson: JSON.stringify(description) }], media: [] }],
    basis: [{ entityType: "BADGE" as const, entityId: BADGE, v: await versionOf(BADGE) }],
  });

  it("refines the same pending agent draft and refuses a stale revision token", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "original agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    const input = { proposal: await revisionProposal("Awarded for demonstrated bravery."),
      expectedStatusChangedAt: initial.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null };
    expect((await reviseAgentProposal(database, id, input)).ok).toBe(true);
    const saved = (await readAgentProposal(database, id))!;
    expect(saved.id).toBe(id);
    expect(saved.agentName).toBe("original agent");
    expect(saved.changes).toHaveLength(1);
    expect(saved.changes[0]?.after).toEqual({ description: "Awarded for demonstrated bravery." });
    expect(await reviseAgentProposal(database, id, input)).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses staff decisions made from a view predating a refinement", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    const token = initial.statusChangedAt.toISOString();
    expect((await reviseAgentProposal(database, id, { proposal: await revisionProposal("Awarded for demonstrated bravery."), expectedStatusChangedAt: token, reactivate: false, feedbackResponse: null })).ok).toBe(true);
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.approve({ id, expectedStatusChangedAt: token })).success).toBe(false);
    expect((await reviewer.reject({ id, expectedStatusChangedAt: token, reason: "NOT_AN_IMPROVEMENT" })).success).toBe(false);
    expect((await readAgentProposal(database, id))?.status).toBe("PENDING");
  });

  it("requires explicit reactivation and feedback while retaining the staff rejection", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    await database.update(contentProposal).set({ status: "REJECTED", reviewNote: "Specify demonstrated bravery" }).where(eq(contentProposal.id, id));
    const rejected = (await readAgentProposal(database, id))!;
    const input = { proposal: await revisionProposal("Awarded for demonstrated bravery."),
      expectedStatusChangedAt: rejected.statusChangedAt.toISOString(), reactivate: true, feedbackResponse: null };
    expect(await reviseAgentProposal(database, id, input)).toMatchObject({ ok: false, status: 400 });
    expect((await reviseAgentProposal(database, id, { ...input, feedbackResponse: "The wording now specifies demonstrated bravery, addressing the staff note." })).ok).toBe(true);
    const saved = (await readAgentProposal(database, id))!;
    expect(saved.status).toBe("PENDING");
    expect(saved.reviewNote).toBe("Specify demonstrated bravery");
    expect(saved.rationale).toContain("Response to staff feedback");
  });

  const rejectedProposal = async () => {
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.reject({ id: pending!.id, reason: "NOT_AN_IMPROVEMENT", note: "Keep the original." })).success).toBe(true);
    return (await proposalRows())[0]!;
  };

  it("undoes a rejection without changing the draft or live content and allows another decision", async () => {
    const rejected = await rejectedProposal();
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.unreject({ id: rejected.id, expectedStatusChangedAt: rejected.statusChangedAt.toISOString() })).success).toBe(true);
    const [pending] = await proposalRows();
    expect(pending).toMatchObject({ status: "PENDING", rejectReason: null, reviewNote: null, reviewedByUserId: null, outdatedReason: null, changes: rejected.changes, basis: rejected.basis });
    expect(pending!.statusChangedAt.getTime()).toBeGreaterThan(rejected.statusChangedAt.getTime());
    const database = await getTestDatabase();
    expect((await database.query.badge.findFirst({ where: eq(badge.id, BADGE) }))?.description).toBe("Awarded for braveyr in battle.");
    expect((await reviewer.getQueue({ status: "REJECTED" })).items).toHaveLength(0);
    expect((await reviewer.getQueue({ status: "PENDING" })).items.map((row) => row.id)).toEqual([rejected.id]);
    expect((await reviewer.getCounts()).statuses).toMatchObject({ PENDING: 1 });
    expect((await reviewer.approve({ id: rejected.id, expectedStatusChangedAt: pending!.statusChangedAt.toISOString() })).success).toBe(true);
  });

  it("refuses stale undo requests and lets only one concurrent undo succeed", async () => {
    const rejected = await rejectedProposal();
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.unreject({ id: rejected.id, expectedStatusChangedAt: new Date(rejected.statusChangedAt.getTime() - 1).toISOString() })).success).toBe(false);
    expect((await proposalRows())[0]).toEqual(rejected);
    const input = { id: rejected.id, expectedStatusChangedAt: rejected.statusChangedAt.toISOString() };
    const results = await Promise.all([reviewer.unreject(input), reviewer.unreject(input)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await reviewer.reject({ id: rejected.id, reason: "WRONG_CHANGE" })).success).toBe(true);
    expect((await reviewer.unreject(input)).success).toBe(false);
    expect((await proposalRows())[0]?.rejectReason).toBe("WRONG_CHANGE");
  });

  it.each(["PENDING", "APPLIED", "OUTDATED", "REVERTED"] as const)("cannot undo a rejection of a %s proposal", async (status) => {
    const rejected = await rejectedProposal();
    const database = await getTestDatabase();
    await database.update(contentProposal).set({ status }).where(eq(contentProposal.id, rejected.id));
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.unreject({ id: rejected.id, expectedStatusChangedAt: rejected.statusChangedAt.toISOString() })).success).toBe(false);
    expect((await proposalRows())[0]?.status).toBe(status);
  });

  it("denies undoing rejections to players, non-reviewing staff and banned reviewers", async () => {
    const rejected = await rejectedProposal();
    const input = { id: rejected.id, expectedStatusChangedAt: rejected.statusChangedAt.toISOString() };
    for (const userId of [PLAYER, MODERATOR]) {
      const caller = await callerFor(contentReviewRouter, userId);
      expect((await caller.unreject(input)).success).toBe(false);
    }
    const database = await getTestDatabase();
    await database.update(userData).set({ isBanned: true }).where(eq(userData.userId, EDITOR));
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.unreject(input)).success).toBe(false);
    expect((await proposalRows())[0]).toEqual(rejected);
  });

  it.each(["changed", "deleted", "expired"])("outdates a reopened proposal when its basis is %s", async (cause) => {
    const rejected = await rejectedProposal();
    const database = await getTestDatabase();
    if (cause === "changed") await database.update(badge).set({ description: "Changed by another editor." }).where(eq(badge.id, BADGE));
    if (cause === "deleted") await database.delete(badge).where(eq(badge.id, BADGE));
    if (cause === "expired") await database.update(contentProposal).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(contentProposal.id, rejected.id));
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    const outcome = await reviewer.unreject({ id: rejected.id, expectedStatusChangedAt: rejected.statusChangedAt.toISOString() });
    expect(outcome.success).toBe(true);
    expect(outcome.message).toContain("outdated");
    expect((await proposalRows())[0]).toMatchObject({ status: "OUTDATED", rejectReason: null, reviewNote: null, reviewedByUserId: null });
    expect((await reviewer.getQueue({ status: "PENDING" })).items).toHaveLength(0);
    expect((await reviewer.approve({ id: rejected.id })).success).toBe(false);
  });

  it("refuses stale basis, changed targets, and staff or already applied proposals", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    const input = { proposal: await revisionProposal("Awarded for demonstrated bravery."),
      expectedStatusChangedAt: initial.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null };
    expect(await reviseAgentProposal(database, id, { ...input, proposal: { ...input.proposal, basis: [{ entityType: "BADGE", entityId: BADGE, v: "0000000000000000" }] } })).toMatchObject({ ok: false, status: 422 });
    expect(await reviseAgentProposal(database, id, { ...input, proposal: { ...input.proposal, changes: [{ ...input.proposal.changes[0]!, entityId: OTHER_BADGE }] } })).toMatchObject({ ok: false, status: 400 });
    await database.update(contentProposal).set({ source: "STAFF" }).where(eq(contentProposal.id, id));
    expect(await reviseAgentProposal(database, id, input)).toMatchObject({ ok: false, status: 409 });
    await database.update(contentProposal).set({ source: "AGENT", status: "APPLIED" }).where(eq(contentProposal.id, id));
    expect(await reviseAgentProposal(database, id, input)).toMatchObject({ ok: false, status: 409 });
    expect((await readAgentProposal(database, id))?.changes[0]?.after).toEqual(initial.changes[0]?.after);
  });

  it("does not overwrite a staff decision made while revision media is prepared", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    let release: () => void = () => {};
    let preparing: () => void = () => {};
    const ready = new Promise<void>((resolve) => { preparing = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const deleted = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    vi.spyOn(media, "collectCandidates").mockImplementation(async () => {
      preparing();
      await wait;
      return [{ kind: "IMAGE", source: "GENERATED", externalId: null,
        url: "https://ui0arpl8sm.ufs.sh/f/refined-badge.webp", fileKey: "unused-revision-file", lengthMs: null, prompt: "A badge portrait", title: "Refined badge" }];
    });
    const proposal = await revisionProposal("Awarded for demonstrated bravery.");
    const refining = reviseAgentProposal(database, id, {
      expectedStatusChangedAt: initial.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null,
      proposal: { ...proposal, changes: [{ ...proposal.changes[0]!, media: [{ kind: "IMAGE", path: "image", catalogIds: [], search: null, generate: "A badge portrait" }] }] },
    });
    await ready;
    await database.update(contentProposal).set({ status: "APPLIED", statusChangedAt: new Date(initial.statusChangedAt.getTime() + 1) }).where(eq(contentProposal.id, id));
    release();
    expect(await refining).toMatchObject({ ok: false, status: 409 });
    const saved = (await readAgentProposal(database, id))!;
    expect(saved.status).toBe("APPLIED");
    expect(saved.changes[0]?.after).toEqual(initial.changes[0]?.after);
    expect(deleted).toHaveBeenCalledWith(["unused-revision-file"]);
  });

  it("lets only one concurrent refinement commit and deletes the losing upload", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    let release: () => void = () => {};
    let bothPreparing: () => void = () => {};
    let calls = 0;
    const ready = new Promise<void>((resolve) => { bothPreparing = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const deleted = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    vi.spyOn(media, "collectCandidates").mockImplementation(async () => {
      const key = `revision-${++calls}`;
      if (calls === 2) bothPreparing();
      await wait;
      return [{ kind: "IMAGE", source: "GENERATED", externalId: null,
        url: `https://ui0arpl8sm.ufs.sh/f/${key}.webp`, fileKey: key,
        lengthMs: null, prompt: "A badge portrait", title: "Badge" }];
    });
    const proposal = await revisionProposal("Awarded for demonstrated bravery.");
    const input = {
      expectedStatusChangedAt: initial.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null,
      proposal: { ...proposal, changes: [{ ...proposal.changes[0]!, media: [{ kind: "IMAGE" as const, path: "image", catalogIds: [], search: null, generate: "A badge portrait" }] }] },
    };
    const first = reviseAgentProposal(database, id, input);
    const second = reviseAgentProposal(database, id, input);
    await ready;
    release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ status: 409 });
    const saved = (await readAgentProposal(database, id))!;
    expect(saved.media).toHaveLength(1);
    expect(saved.changes).toHaveLength(1);
    const winnerKey = saved.media[0]!.fileKey;
    const losingKey = winnerKey === "revision-1" ? "revision-2" : "revision-1";
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith([losingKey]);
    expect(saved.statusChangedAt.toISOString()).not.toBe(input.expectedStatusChangedAt);
  });

  it("refuses content edited while refinement media is prepared and cleans its upload", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    let release: () => void = () => {};
    let preparing: () => void = () => {};
    const ready = new Promise<void>((resolve) => { preparing = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const deleted = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    vi.spyOn(media, "collectCandidates").mockImplementation(async () => {
      preparing();
      await wait;
      return [{ kind: "IMAGE", source: "GENERATED", externalId: null,
        url: "https://ui0arpl8sm.ufs.sh/f/obsolete.webp", fileKey: "obsolete-file",
        lengthMs: null, prompt: "A badge portrait", title: "Badge" }];
    });
    const proposal = await revisionProposal("Awarded for demonstrated bravery.");
    const refining = reviseAgentProposal(database, id, {
      expectedStatusChangedAt: initial.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null,
      proposal: { ...proposal, changes: [{ ...proposal.changes[0]!, media: [{ kind: "IMAGE", path: "image", catalogIds: [], search: null, generate: "A badge portrait" }] }] },
    });
    await ready;
    await database.update(badge).set({ description: "Edited while generating art." }).where(eq(badge.id, BADGE));
    release();
    expect(await refining).toMatchObject({ ok: false, status: 409 });
    const saved = (await readAgentProposal(database, id))!;
    expect(saved.statusChangedAt).toEqual(initial.statusChangedAt);
    expect(saved.changes[0]!.after).toEqual(initial.changes[0]!.after);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith(["obsolete-file"]);
  });

  it("does not outdate a new refinement using an old freshness snapshot", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const initial = (await readAgentProposal(database, id))!;
    expect(await reviseAgentProposal(database, id, {
      expectedStatusChangedAt: initial.statusChangedAt.toISOString(), reactivate: false,
      feedbackResponse: null, proposal: await revisionProposal("Awarded for demonstrated bravery."),
    })).toMatchObject({ ok: true });
    const revised = (await readAgentProposal(database, id))!;
    await refreshProposalFreshness(database, [{
      ...initial, expiresAt: new Date(Date.now() - 1000),
    }]);
    const saved = (await readAgentProposal(database, id))!;
    expect(saved.status).toBe("PENDING");
    expect(saved.statusChangedAt).toEqual(revised.statusChangedAt);
    expect(saved.changes).toEqual(revised.changes);
  });

  it("keeps generated scene art as a candidate until approval creates a character asset", async () => {
    const database = await getTestDatabase();
    await insertQuests([{ id: "cast-quest", name: "Village service award", questType: "achievement", description: "Recognize village service", hidden: false, consecutiveObjectives: false }]);
    const entity = (await loadEntities(database, [{ entityType: "QUEST", entityId: "cast-quest" }])).get(entityKey("QUEST", "cast-quest"))!;
    const collector = vi.spyOn(media, "collectCandidates").mockResolvedValue([{ kind: "IMAGE", source: "GENERATED", externalId: null, title: "Village representative", url: "https://ui0arpl8sm.ufs.sh/f/elder-cutout.png", fileKey: null, lengthMs: null, prompt: "A calm village representative" }]);
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [{ title: "Add a village award representative", category: "VISUAL", rationale: "A visible calm elder suits the civic award scene.", confidence: 90, usesUsageData: false,
      changes: [{ entityType: "QUEST", entityId: "cast-quest", operation: "UPDATE", set: [], media: [{ kind: "IMAGE", path: "content.sceneCharacters.0", catalogIds: [], search: null, generate: "A calm village representative" }] }], basis: [{ entityType: "QUEST", entityId: "cast-quest", v: entity.version }] }] });
    expect(submitted.refused).toEqual([]);
    const id = submitted.accepted[0]!.id;
    expect(await database.query.gameAsset.findMany()).toHaveLength(0);
    const candidate = (await readAgentProposal(database, id))!;
    expect((candidate.changes[0]?.after.content as { sceneCharacters: string[] }).sceneCharacters[0]).toMatch(/^media:/);
    collector.mockClear();
    vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    const submittedProposal = { title: "Add a village award representative", category: "VISUAL" as const, rationale: "Inspected the actual generated cutout and its calm award-scene appearance.", confidence: 90, usesUsageData: false,
      changes: [{ entityType: "QUEST" as const, entityId: "cast-quest", operation: "UPDATE" as const, set: [], media: [{ kind: "IMAGE" as const, path: "content.sceneCharacters.0", catalogIds: [], search: null, generate: null }] }], basis: [{ entityType: "QUEST" as const, entityId: "cast-quest", v: entity.version }] };
    expect((await reviseAgentProposal(database, id, { expectedStatusChangedAt: candidate.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null, retainMediaIds: [candidate.media[0]!.id], proposal: submittedProposal })).ok).toBe(true);
    expect(collector).not.toHaveBeenCalled();
    const retained = (await readAgentProposal(database, id))!;
    expect(retained.media[0]?.url).toBe(candidate.media[0]?.url);
    expect(retained.media[0]?.chosen).toBe(false);
    expect(await reviseAgentProposal(database, id, { expectedStatusChangedAt: retained.statusChangedAt.toISOString(), reactivate: false, feedbackResponse: null, retainMediaIds: ["another-proposals-candidate"], proposal: submittedProposal })).toMatchObject({ ok: false, status: 400 });
    const reviewer = await callerFor(contentReviewRouter, EDITOR);
    expect((await reviewer.approve({ id })).success).toBe(true);
    const saved = (await database.query.quest.findFirst({ where: eq(quest.id, "cast-quest") }))!;
    const [asset] = await database.query.gameAsset.findMany();
    expect(asset).toMatchObject({ type: "SCENE_CHARACTER", image: "https://ui0arpl8sm.ufs.sh/f/elder-cutout.png" });
    expect(saved.content.sceneCharacters).toEqual([asset!.id]);
    expect(saved.description).toBe("Recognize village service");
  });

  it("retains distinct media for multiple new entities of the same type", async () => {
    const database = await getTestDatabase();
    const collector = vi.spyOn(media, "collectCandidates").mockImplementation(async (client, request) => [{
      kind: "IMAGE", source: "GENERATED", externalId: null,
      title: request.generate!, prompt: request.generate!,
      url: `https://ui0arpl8sm.ufs.sh/f/${request.generate}.webp`,
      fileKey: `${request.generate}-file`, lengthMs: null,
    }]);
    const deleted = vi.spyOn(media, "deleteStoredFiles").mockResolvedValue(undefined);
    const proposal = {
      title: "Add separate achievement badges", category: "VISUAL" as const,
      rationale: "Each achievement needs its own recognizable badge art.", confidence: 90,
      usesUsageData: false, basis: [],
      changes: ["bravery", "patience"].map((name) => ({
        entityType: "BADGE" as const, entityId: null, operation: "CREATE" as const,
        set: [{ path: "name", valueJson: JSON.stringify(name) },
          { path: "description", valueJson: JSON.stringify(`Awarded for ${name}.`) }],
        media: [{ kind: "IMAGE" as const, path: "image", catalogIds: [], search: null, generate: name }],
      })),
    };
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [proposal] });
    expect(submitted.refused).toEqual([]);
    const id = submitted.accepted[0]!.id;
    const original = (await readAgentProposal(database, id))!;
    collector.mockClear();
    expect(await reviseAgentProposal(database, id, {
      expectedStatusChangedAt: original.statusChangedAt.toISOString(), reactivate: false,
      feedbackResponse: null, retainMediaIds: original.media.map((row) => row.id),
      proposal: { ...proposal, changes: proposal.changes.map((change) => ({
        ...change, media: change.media.map((request) => ({ ...request, generate: null })),
      })) },
    })).toMatchObject({ ok: true });
    const revised = (await readAgentProposal(database, id))!;
    expect(revised.media).toHaveLength(2);
    for (const change of revised.changes) {
      const name = change.after.name as string;
      expect(change.after.image).toBe(`https://ui0arpl8sm.ufs.sh/f/${name}.webp`);
      expect(revised.media.filter((row) => row.changeId === change.id)).toHaveLength(1);
    }
    expect(collector).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  });

  it.each(["MODERATOR", "MODERATOR-ADMIN", "HEAD_MODERATOR", "JR_MODERATOR"] as const)("rejects suggestions from %s before writing", async (role) => {
    await (await getTestDatabase()).update(userData).set({ role }).where(eq(userData.userId, MODERATOR));
    const moderator = await callerFor(contentReviewRouter, MODERATOR);
    expect(await moderator.create(suggestion("Awarded for bravery in battle."))).toMatchObject({ success: false, message: "Your role cannot suggest content changes" });
    expect(await proposalRows()).toEqual([]);
  });

  it("stores only the changed fields of a staff suggestion", async () => {
    const author = await callerFor(contentReviewRouter, AUTHOR);
    const result = await author.create(suggestion("Awarded for bravery in battle."));
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    const input = suggestion("Awarded for bravery in battle.");
    await author.create({ ...input, data: { ...input.data, name: ` ${input.data.name} ` } });
    const [row] = await proposalRows();
    expect(row?.changes[0]?.after).toEqual({ description: "Awarded for bravery in battle." });
  });

  it("ignores fields a form leaves empty where the database holds null", async () => {
    const [row] = await insertItems([
      {
        id: "review-item",
        name: "Review Kunai",
        image: "https://ui0arpl8sm.ufs.sh/f/kunai.webp",
        description: "A plain kunai.",
      },
    ]);
    const live = (
      await loadEntities(await getTestDatabase(), [
        { entityType: "ITEM", entityId: "review-item" },
      ])
    ).get(entityKey("ITEM", "review-item"));
    const author = await callerFor(contentReviewRouter, AUTHOR);
    const result = await author.create({
      entityType: "ITEM",
      entityId: row?.id ?? "",
      category: "GRAMMAR",
      title: "Sharpen the kunai description",
      rationale: "The description undersells the item.",
      data: { ...live?.payload, description: "A well balanced kunai.", bloodlineId: "", parentItemId: "" },
    });
    expect(result.success).toBe(true);
    const [stored] = await proposalRows();
    expect(stored?.changes[0]?.after).toEqual({ description: "A well balanced kunai." });
  });

  it("records the defaults an update fills in, so an effect change can be reverted", async () => {
    const database = await getTestDatabase();
    const ref = { entityType: "ITEM" as const, entityId: "review-blade" };
    await insertItems([
      {
        id: ref.entityId,
        name: "Review Blade",
        image: "https://ui0arpl8sm.ufs.sh/f/blade.webp",
        hidden: true,
        // Stored without the defaults the item update fills in, as older rows are.
        effects: [
          { type: "damage", power: 10, rounds: 0, description: "Cuts the target" },
        ] as never,
      },
    ]);
    const live = (await loadEntities(database, [ref])).get(entityKey("ITEM", ref.entityId));
    const [effect] = live?.editable.effects as Record<string, unknown>[];
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create({
      ...ref,
      category: "SOUND",
      title: "Give the blade a sound",
      rationale: "The blade makes no sound when it hits.",
      data: { ...live?.payload, effects: [{ ...effect, appearSfx: "sfx-slash" }] },
    });
    const [created] = await proposalRows();
    const editor = await callerFor(contentReviewRouter, EDITOR);
    expect((await editor.approve({ id: created?.id ?? "" })).success).toBe(true);
    const stored = (await loadEntities(database, [ref])).get(entityKey("ITEM", ref.entityId));
    const [row] = await proposalRows();
    expect(row?.changes[0]?.applied).toEqual({ effects: stored?.editable.effects });
    // A record without the filled-in defaults still matches the row they were saved into.
    await database
      .update(contentProposalChange)
      .set({ applied: { effects: [{ ...effect, appearSfx: "sfx-slash" }] } })
      .where(eq(contentProposalChange.id, row?.changes[0]?.id ?? ""));
    expect((await editor.revert({ id: created?.id ?? "" })).success).toBe(true);
  });

  it("applies an approval through the badge's own update and can revert it", async () => {
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const editor = await callerFor(contentReviewRouter, EDITOR);

    const moderator = await callerFor(contentReviewRouter, MODERATOR);
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
    await author.create({
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    for (const id of [BADGE, OTHER_BADGE, "review-badge-3"]) {
      await author.create({
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create({
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
    const badges = await callerFor(badgeRouter, EDITOR);
    await badges.update({ id: BADGE, data: badgeRow(BADGE, "Awarded for braveyr in battle.") });
    expect((await proposalRows())[0]?.status).toBe("PENDING");
  });

  it("catches edits that bypassed the editors when the queue is read", async () => {
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
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
    const author = await callerFor(contentReviewRouter, AUTHOR);
    await author.create(suggestion("Awarded for bravery in battle."));
    const [pending] = await proposalRows();
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const results = await Promise.all([
      editor.approve({ id: pending?.id ?? "" }),
      editor.approve({ id: pending?.id ?? "" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
  });

  it("refuses stale, duplicate and invalid audit suggestions", async () => {
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

  it("lets the audit reprice and hide content but not in reputation or seichi silver", async () => {
    const database = await getTestDatabase();
    const ref = { entityType: "ITEM" as const, entityId: "review-kunai" };
    await insertItems([
      {
        id: ref.entityId,
        name: "Review Kunai",
        image: "https://ui0arpl8sm.ufs.sh/f/kunai.webp",
        cost: 100,
      },
    ]);
    const live = (await loadEntities(database, [ref])).get(entityKey("ITEM", ref.entityId));
    const proposal = (
      change: { entityType: "ITEM" | "GAME_ASSET"; entityId: string | null },
      set: Record<string, unknown>,
    ) => ({
      title: "Bring the kunai in line with its peers",
      category: "BALANCE" as const,
      rationale: "The kunai costs more than every other common weapon.",
      confidence: 70,
      usesUsageData: false,
      changes: [
        {
          ...change,
          operation: change.entityId ? ("UPDATE" as const) : ("CREATE" as const),
          set: Object.entries(set).map(([path, value]) => ({
            path,
            valueJson: JSON.stringify(value),
          })),
          media: [],
        },
      ],
      basis: change.entityId ? [{ ...ref, v: live?.version ?? "" }] : [],
    });
    const result = await ingestAgentSubmission(database, {
      agentName: "codex · test",
      runUrl: null,
      focus: "balance",
      proposals: [
        proposal(ref, { cost: 90, hidden: true }),
        proposal({ entityType: "ITEM", entityId: null }, { name: "Review Shuriken", repsCost: 50 }),
        proposal({ entityType: "GAME_ASSET", entityId: null }, { name: "Review Sound" }),
      ],
    });
    expect(result.accepted.map((entry) => entry.index)).toEqual([0]);
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      "repsCost: reputation points and seichi silver are off limits for the audit",
      "New assets come from media candidates, not drafts",
    ]);
    const [stored] = await proposalRows();
    expect(stored?.changes[0]?.after).toEqual({ cost: 90, hidden: true });
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

  it("cannot reactivate a proposal while retention cleanup deletes its old files", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    await database.update(contentProposal).set({ status: "REJECTED", statusChangedAt: new Date(Date.now() - (CONTENT_PROPOSAL_RETENTION_DAYS + 1) * 86_400_000) }).where(eq(contentProposal.id, id));
    await database.insert(contentProposalMedia).values({ id: "retained-old-media", proposalId: id,
      changeId: (await readAgentProposal(database, id))!.changes[0]!.id,
      path: "image", kind: "IMAGE", source: "GENERATED", title: "Old image",
      url: "https://ui0arpl8sm.ufs.sh/f/old-candidate.webp", fileKey: "old-candidate-file" });
    const original = (await readAgentProposal(database, id))!;
    let cleanupStarted: () => void = () => {};
    let releaseCleanup: () => void = () => {};
    let mediaPrepared: () => void = () => {};
    let releaseMedia: () => void = () => {};
    const mediaRelease = new Promise<void>((resolve) => { releaseMedia = resolve; });
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const prepared = new Promise<void>((resolve) => { mediaPrepared = resolve; });
    const deleted = vi.spyOn(media, "deleteStoredFiles").mockImplementation(async (keys) => {
      if (keys.includes("old-candidate-file")) { cleanupStarted(); await release; }
    });
    vi.spyOn(media, "collectCandidates").mockImplementation(async () => {
      mediaPrepared();
      await mediaRelease;
      return [{ kind: "IMAGE", source: "GENERATED", externalId: null,
        url: "https://ui0arpl8sm.ufs.sh/f/new-candidate.webp", fileKey: "new-candidate-file",
        lengthMs: null, prompt: "A new badge", title: "New badge" }];
    });
    const proposal = await revisionProposal("Awarded for demonstrated bravery.");
    const revising = reviseAgentProposal(database, id, { expectedStatusChangedAt: original.statusChangedAt.toISOString(),
      reactivate: true, feedbackResponse: "Clarify the wording to address the earlier rejection.",
      proposal: { ...proposal, changes: [{ ...proposal.changes[0]!, media: [{ kind: "IMAGE", path: "image", catalogIds: [], search: null, generate: "A new badge" }] }] } });
    await prepared;
    const cleaning = cleanupContentProposals(database);
    await started;
    releaseMedia();
    // The revision loses immediately even while storage is blocked; no database lock waits.
    expect(await revising).toMatchObject({ ok: false, status: 409 });
    releaseCleanup();
    expect((await cleaning).removed).toBe(1);
    expect(await readAgentProposal(database, id)).toBeUndefined();
    expect(deleted).toHaveBeenCalledWith(["new-candidate-file"]);
  });

  it("retries orphan files after storage failure without reviving a deleted proposal", async () => {
    const database = await getTestDatabase();
    const submitted = await ingestAgentSubmission(database, { agentName: "agent", proposals: [await revisionProposal()] });
    const id = submitted.accepted[0]!.id;
    const original = (await readAgentProposal(database, id))!;
    await database.update(contentProposal).set({ status: "REJECTED", statusChangedAt: new Date(Date.now() - (CONTENT_PROPOSAL_RETENTION_DAYS + 1) * 86_400_000) }).where(eq(contentProposal.id, id));
    await database.insert(contentProposalMedia).values([
      { id: "retry-file", proposalId: id, changeId: original.changes[0]!.id, path: "image", kind: "IMAGE", source: "GENERATED", title: "Retry image", url: "https://example.com/retry.webp", fileKey: "retry-file-key", chosen: true },
      { id: "orphan-catalog", proposalId: id, changeId: original.changes[0]!.id, path: "image", kind: "IMAGE", source: "CATALOG", title: "Catalog image" },
    ]);
    const deletion = vi.spyOn(media, "deleteStoredFiles").mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue(undefined);
    await expect(cleanupContentProposals(database)).rejects.toThrow("Storage unavailable");
    expect(await readAgentProposal(database, id)).toBeUndefined();
    expect(await database.query.contentProposalMedia.findMany()).toHaveLength(2);
    expect(await database.query.contentProposalChange.findMany()).toHaveLength(1);
    expect(await database.query.contentProposalBasis.findMany()).not.toHaveLength(0);
    expect(await cleanupContentProposals(database)).toEqual({ removed: 0, filesDeleted: 1 });
    expect(deletion).toHaveBeenCalledWith(["retry-file-key"]);
    expect(await database.query.contentProposalMedia.findMany()).toHaveLength(0);
    expect(await database.query.contentProposalChange.findMany()).toHaveLength(0);
    expect(await database.query.contentProposalBasis.findMany()).toHaveLength(0);
  });

  it("filters analytics by entity and agent while counting each proposal once", async () => {
    const database = await getTestDatabase();
    await database.insert(contentProposal).values([
      { id: "stats-applied", title: "Applied", rationale: "Analytics fixture", category: "GRAMMAR", source: "AGENT", agentName: "Codex", status: "APPLIED" },
      { id: "stats-rejected", title: "Rejected", rationale: "Analytics fixture", category: "GRAMMAR", source: "AGENT", agentName: "Claude", status: "REJECTED" },
    ]);
    await database.insert(contentProposalChange).values([
      { id: "stats-change-1", proposalId: "stats-applied", entityType: "ITEM", before: {}, after: {} },
      { id: "stats-change-2", proposalId: "stats-applied", entityType: "ITEM", before: {}, after: {} },
      { id: "stats-change-3", proposalId: "stats-rejected", entityType: "BADGE", before: {}, after: {} },
    ]);
    const editor = await callerFor(contentReviewRouter, EDITOR);
    const stats = await editor.getStats({ days: 90, interval: "weekly", entityType: "ITEM", agentName: "Codex" });
    expect(stats.summary.total).toBe(1);
    expect(stats.summary.acceptanceRate).toBe(100);
    expect(stats.agents).toEqual(["Claude", "Codex"]);
    expect(stats.trend.reduce((sum, row) => sum + row.total, 0)).toBe(1);
    expect(stats.breakdown).toHaveLength(1);
    expect((await editor.getStats({})).summary.acceptanceRate).toBe(50);
    const player = await callerFor(contentReviewRouter, PLAYER);
    const hidden = await player.getStats({});
    expect(hidden.summary.total).toBe(0);
    expect(hidden.agents).toEqual([]);
  });

  it("removes rejected suggestions once the retention window has passed", async () => {
    const database = await getTestDatabase();
    const old = new Date(Date.now() - (CONTENT_PROPOSAL_RETENTION_DAYS + 1) * 86_400_000);
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
        rationale: "Still within retention.",
        statusChangedAt: new Date(Date.now() - 89 * 86_400_000),
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
