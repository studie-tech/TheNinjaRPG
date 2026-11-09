import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  aiProfile,
  aiSpriteAnimation,
  battle,
  contentProposal,
  contentProposalBasis,
  jutsu,
  spriteAnimation,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import { loadEntities } from "@/libs/contentReview/entities";
import { contentVersion } from "@/libs/contentReview/version";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { profileRouter } from "@/server/api/routers/profile";
import { spriteAnimationRouter } from "@/server/api/routers/spriteAnimation";
import { insertUsers, insertDefaultAiProfile } from "../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("sprite animation administration and battle snapshots", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      aiSpriteAnimation,
      spriteAnimation,
      battle,
      contentProposalBasis,
      contentProposal,
      actionLog,
      userJutsu,
      jutsu,
      aiProfile,
      userData,
    );
    await insertUsers([
      {
        userId: "editor",
        username: "Editor",
        role: "CONTENT",
        rank: "JONIN",
        level: 50,
      },
      { userId: "player", username: "Player", rank: "JONIN", level: 50 },
      { userId: "ai", username: "AI", isAi: true, rank: "JONIN", level: 50 },
    ]);
    const db = await getTestDatabase();
    await insertDefaultAiProfile({ userId: "ai" });
    await db.insert(spriteAnimation).values(
      ["idle", "move"].map((id) => ({
        id,
        name: id,
        url: `https://example.com/${id}.png`,
        columns: 6,
        rows: 4,
        frameCount: 24,
        fps: 12.5,
        facing: "left" as const,
        createdByUserId: "editor",
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const caller = async (id = "editor") =>
    callerForDatabase(spriteAnimationRouter, id, await getTestDatabase());
  it("requires content permissions and rejects actions this AI cannot take", async () => {
    expect(
      (
        await (
          await caller("player")
        ).assign({ userId: "ai", actionKey: "idle", animationId: "idle" })
      ).success,
    ).toBe(false);
    expect(
      (
        await (
          await caller()
        ).assign({ userId: "ai", actionKey: "jutsu:unknown", animationId: "idle" })
      ).success,
    ).toBe(false);
    expect(
      (
        await (
          await caller()
        ).assign({ userId: "player", actionKey: "idle", animationId: "idle" })
      ).success,
    ).toBe(false);
    expect(
      (
        await (
          await caller()
        ).assign({ userId: "ai", actionKey: "idle", animationId: "missing" })
      ).success,
    ).toBe(false);
  });
  it("returns only this AI's own sheets with its config, and searches the library in pages", async () => {
    const db = await getTestDatabase();
    const api = await caller();
    await db.insert(spriteAnimation).values(
      ["AI — Strike", "AI — Walk", "Other — Strike"].map((name) => ({
        id: name,
        name,
        url: "https://example.com/sheet.png",
        columns: 8,
        rows: 2,
        frameCount: 16,
        fps: 12.5,
        facing: "left" as const,
        createdByUserId: "editor",
      })),
    );
    await api.assign({ userId: "ai", actionKey: "idle", animationId: "move" });
    expect(
      (await api.getAiConfig({ userId: "ai" })).animations.map((sheet) => sheet.id),
    ).toEqual(["move"]);

    const search = { userId: "ai", search: "", limit: 2 };
    const names = (page: { data: { id: string }[] }) =>
      page.data.map((sheet) => sheet.id);
    const first = await api.search({ ...search, scope: "ai" });
    expect(names(first)).toEqual(["AI — Strike", "AI — Walk"]);
    expect(first).toMatchObject({ total: 3, nextCursor: 1 });
    const second = await api.search({
      ...search,
      scope: "ai",
      cursor: first.nextCursor,
    });
    expect(names(second)).toEqual(["move"]);
    expect(second.nextCursor).toBeNull();
    const exact = await api.search({ ...search, scope: "ai", limit: 3 });
    expect(exact).toMatchObject({ total: 3, nextCursor: null });

    expect((await api.search({ ...search, scope: "all" })).total).toBe(5);
    expect(
      names(await api.search({ ...search, scope: "all", search: "strike other" })),
    ).toEqual(["Other — Strike"]);
    expect((await api.search({ ...search, scope: "ai", search: "other" })).total).toBe(
      0,
    );

    await db.insert(spriteAnimation).values({
      id: "held",
      name: "[Held] AI — Old",
      url: "https://example.com/held.png",
      columns: 8,
      rows: 2,
      frameCount: 16,
      fps: 12.5,
      facing: "left",
      createdByUserId: "editor",
    });
    const everything = await api.search({ ...search, scope: "all", limit: 10 });
    expect(names(everything).at(-1)).toBe("held");
  });
  it("keeps library search behind content permissions", async () => {
    await expect(
      (await caller("player")).search({
        userId: "ai",
        scope: "all",
        search: "",
        limit: 2,
      }),
    ).rejects.toThrow("Content editor access required");
    await expect(
      (await caller()).search({ userId: "player", scope: "ai", search: "", limit: 2 }),
    ).rejects.toThrow("AI not found");
  });
  it("upserts and clears assignments while retaining reusable sheets and changing review basis", async () => {
    const db = await getTestDatabase();
    const api = await caller();
    const original = (
      await loadEntities(db, [{ entityType: "AI", entityId: "ai" }])
    ).get("AI:ai")!;
    const before = original.version;
    expect(before).toBe(contentVersion(original.editable));
    expect(
      (await api.assign({ userId: "ai", actionKey: "idle", animationId: "idle" }))
        .success,
    ).toBe(true);
    const after = (await loadEntities(db, [{ entityType: "AI", entityId: "ai" }])).get(
      "AI:ai",
    )!.version;
    expect(after).not.toBe(before);
    await api.assign({ userId: "ai", actionKey: "idle", animationId: "move" });
    expect(
      (await db.query.aiSpriteAnimation.findMany()).map((entry) => entry.animationId),
    ).toEqual(["move"]);
    await api.assign({ userId: "ai", actionKey: "idle", animationId: null });
    expect(await db.query.aiSpriteAnimation.findMany()).toHaveLength(0);
    expect(await db.query.spriteAnimation.findMany()).toHaveLength(2);
    const cleared = (
      await loadEntities(db, [{ entityType: "AI", entityId: "ai" }])
    ).get("AI:ai")!.version;
    expect(cleared).toBe(before);
    expect(cleared).not.toBe(after);
  });
  it("outdates proposals after binding changes while retaining current proposals on an unchanged save", async () => {
    const db = await getTestDatabase();
    const api = await caller();
    /** Seed a pending suggestion against the AI's actual current review version. */
    const saveProposal = async (id: string) => {
      const entity = (
        await loadEntities(db, [{ entityType: "AI", entityId: "ai" }])
      ).get("AI:ai")!;
      await Promise.all([
        db.insert(contentProposal).values({
          id,
          title: "Review this AI's animation",
          rationale: "Animation choices depend on the current AI bindings.",
          category: "ANIMATION",
          source: "STAFF",
        }),
        db.insert(contentProposalBasis).values({
          proposalId: id,
          entityType: "AI",
          entityId: "ai",
          version: entity.version,
          role: "TARGET",
        }),
      ]);
    };
    await db
      .update(userData)
      .set({ updatedAt: new Date("2020-01-01") })
      .where(eq(userData.userId, "ai"));
    await saveProposal("before-assignment");
    expect(
      (await api.assign({ userId: "ai", actionKey: "idle", animationId: "idle" }))
        .success,
    ).toBe(true);
    expect(
      (
        await db.query.contentProposal.findFirst({
          where: eq(contentProposal.id, "before-assignment"),
        })
      )?.status,
    ).toBe("OUTDATED");
    expect(
      (await db.query.userData.findFirst({
        where: eq(userData.userId, "ai"),
      }))!.updatedAt.getTime(),
    ).toBeGreaterThan(new Date("2020-01-01").getTime());
    expect(
      await db.query.actionLog.findMany({ where: eq(actionLog.relatedId, "ai") }),
    ).toHaveLength(1);

    await saveProposal("current-assignment");
    expect(
      (await api.assign({ userId: "ai", actionKey: "idle", animationId: "idle" }))
        .success,
    ).toBe(true);
    expect(
      (
        await db.query.contentProposal.findFirst({
          where: eq(contentProposal.id, "current-assignment"),
        })
      )?.status,
    ).toBe("PENDING");

    expect(
      (await api.assign({ userId: "ai", actionKey: "idle", animationId: null }))
        .success,
    ).toBe(true);
    expect(
      (
        await db.query.contentProposal.findFirst({
          where: eq(contentProposal.id, "current-assignment"),
        })
      )?.status,
    ).toBe("OUTDATED");
    expect(
      await db.query.actionLog.findMany({ where: eq(actionLog.relatedId, "ai") }),
    ).toHaveLength(3);
  });
  it("freezes animations at initiation, including their real source facing, without author metadata", async () => {
    const db = await getTestDatabase();
    await (await caller()).assign({
      userId: "ai",
      actionKey: "idle",
      animationId: "idle",
    });
    expect(
      (
        await initiateBattle(
          { client: db, userIds: ["player"], targetIds: ["ai"] },
          "QUEST",
        )
      ).success,
    ).toBe(true);
    const saved = (await db.query.battle.findFirst())!;
    const npc = saved.usersState.find((user) => user.controllerId === "ai")!;
    expect(npc.spriteAnimations?.idle).toMatchObject({
      id: "idle",
      fps: 12.5,
      facing: "left",
    });
    expect(npc.spriteAnimations?.idle).not.toHaveProperty("createdByUserId");
    expect(npc).not.toHaveProperty("spriteAnimationBindings");
    await (await caller()).assign({
      userId: "ai",
      actionKey: "idle",
      animationId: "move",
    });
    const persisted = await db.query.battle.findFirst({
      where: eq(battle.id, saved.id),
    });
    expect(
      persisted!.usersState.find((user) => user.controllerId === "ai")!.spriteAnimations
        ?.idle?.id,
    ).toBe("idle");
  });
  it("copies assignments when cloning an AI and removes only bindings when deleting the clone", async () => {
    const db = await getTestDatabase();
    await (await caller()).assign({
      userId: "ai",
      actionKey: "idle",
      animationId: "idle",
    });
    const profile = callerForDatabase(profileRouter, "editor", db);
    const cloned = await profile.cloneAi({ id: "ai" });
    expect(cloned.success).toBe(true);
    const cloneId = cloned.message;
    expect(
      await db.query.aiSpriteAnimation.findMany({
        where: eq(aiSpriteAnimation.userId, cloneId),
      }),
    ).toMatchObject([{ userId: cloneId, actionKey: "idle", animationId: "idle" }]);
    expect((await profile.delete({ id: cloneId })).success).toBe(true);
    expect(
      await db.query.aiSpriteAnimation.findMany({
        where: eq(aiSpriteAnimation.userId, cloneId),
      }),
    ).toHaveLength(0);
    expect(
      await db.query.aiSpriteAnimation.findMany({
        where: eq(aiSpriteAnimation.userId, "ai"),
      }),
    ).toHaveLength(1);
    expect(await db.query.spriteAnimation.findMany()).toHaveLength(2);
  });
});
