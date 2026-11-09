import { eq } from "drizzle-orm";
import { beforeEach, expect, it, setSystemTime } from "bun:test";
import {
  actionLog,
  bloodlineReskin,
  contentProposal,
  contentProposalBasis,
  item,
  jutsu,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import { loadEntities, entityKey } from "@/libs/contentReview/entities";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { fetchUserJutsus, jutsuRouter } from "@/server/api/routers/jutsu";
import type { DrizzleClient } from "@/server/db";
import { DamageTag, JutsuValidator } from "@/validators/combat";
import { insertItems, insertUsers, insertJutsus } from "../../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { deferred } from "../../../../setup/deferred";
import { beforeTransaction } from "../../../../setup/statements";

const staff = () => callerFor(jutsuRouter, "staff");
const read = async (id: string) => {
  const db = await getTestDatabase();
  const [row] = await db.select().from(jutsu).where(eq(jutsu.id, id));
  if (!row) throw new Error(`Missing fixture ${id}`);
  return row;
};
const save = async (id: string, patch: Record<string, unknown> = {}) =>
  (await staff()).update({
    id,
    data: JutsuValidator.parse({ ...(await read(id)), ...patch }),
  });
const createChild = async () => {
  const result = await (await staff()).createLinkedReskin({
    parentId: "parent",
    bloodlineReskinId: "group",
  });
  expect(result.success).toBe(true);
  return result.message;
};

// Pause after upfront guards; the transaction still executes against real MySQL.
const pauseBeforeTransaction = (database: DrizzleClient) => {
  const { promise: reached, resolve: signalReached } = deferred<void>();
  const { promise: resumed, resolve: release } = deferred<void>();
  const client = beforeTransaction(database, async () => {
    signalReached();
    await resumed;
  });
  return { client, reached, release };
};

describeWithDatabase("linked H-rank jutsu against real MySQL", () => {
  beforeEach(async () => {
    // Training loads equipment; reset inventory with its item catalogue.
    await resetTables(
      contentProposalBasis,
      contentProposal,
      actionLog,
      userJutsu,
      jutsu,
      bloodlineReskin,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      { userId: "staff", username: "Staff", role: "CONTENT" },
      { userId: "player", username: "Player" },
    ] as never);
    const db = await getTestDatabase();
    await insertJutsus([
      {
        id: "parent",
        name: "Parent",
        description: "Parent text",
        effects: [
          DamageTag.parse({ power: 4, appearAnimation: "appear", appearSfx: "sound" }),
        ],
        range: 1,
        target: "OTHER_USER",
        requiredRank: "GENIN",
        jutsuType: "BLOODLINE",
        bloodlineId: "blood",
        hidden: true,
      },
    ]);
    await db.insert(bloodlineReskin).values({
      id: "group",
      bloodlineId: "blood",
      name: "Scarlet",
      description: "Scarlet",
      image: "/scarlet.png",
      createdBy: "staff",
    });
  });

  it("resolves only the selected bloodline's cosmetics onto learned base jutsu", async () => {
    const id = await createChild();
    const db = await getTestDatabase();
    await db
      .update(jutsu)
      .set({ hidden: false, jutsuRank: "C" })
      .where(eq(jutsu.id, "parent"));
    await db
      .update(jutsu)
      .set({
        name: "Scarlet attack",
        effects: [DamageTag.parse({ power: 999, staticAnimation: "scarlet" })],
      })
      .where(eq(jutsu.id, id));
    await db
      .update(userData)
      .set({ bloodlineId: "blood", bloodlineReskinId: "group", rank: "GENIN" })
      .where(eq(userData.userId, "player"));
    await db
      .insert(userJutsu)
      .values({ id: "learned", userId: "player", jutsuId: "parent", level: 8 });
    const [resolved] = await fetchUserJutsus(db, "player");
    expect(resolved).toMatchObject({
      id: "learned",
      jutsuId: "parent",
      level: 8,
      jutsu: { id: "parent", name: "Scarlet attack", hidden: false, jutsuRank: "C" },
    });
    expect(resolved?.jutsu.effects[0]).toMatchObject({
      power: 4,
      staticAnimation: "scarlet",
    });
    const [snapshot] = await fetchUserJutsus(db, "player", undefined, {
      applyReskins: false,
    });
    expect(snapshot?.jutsu.name).toBe("Parent");
    expect(snapshot?.linkedReskin?.id).toBe(id);
    // Choosing a cosmetic grants neither a new jutsu nor access to another bloodline.
    expect(await fetchUserJutsus(db, "staff")).toHaveLength(0);
    await db
      .update(userData)
      .set({ bloodlineId: "other" })
      .where(eq(userData.userId, "player"));
    expect((await fetchUserJutsus(db, "player"))[0]?.linkedReskin).toBeNull();
    await db
      .update(userData)
      .set({ bloodlineId: "blood", bloodlineReskinId: null })
      .where(eq(userData.userId, "player"));
    expect((await fetchUserJutsus(db, "player"))[0]?.jutsu.name).toBe("Parent");
  });

  it("rejects training a visible variant without its reskin before charging ryo or granting ownership", async () => {
    const id = await createChild();
    const db = await getTestDatabase();
    // Keep the variant visible so this test isolates reskin eligibility.
    await db.update(jutsu).set({ hidden: false }).where(eq(jutsu.id, id));
    await db
      .update(userData)
      .set({ bloodlineId: "blood", rank: "JONIN", level: 100, money: 1000 })
      .where(eq(userData.userId, "player"));
    const player = await callerFor(jutsuRouter, "player");
    for (const bloodlineReskinId of [null, "other"]) {
      await db
        .update(userData)
        .set({ bloodlineReskinId })
        .where(eq(userData.userId, "player"));
      expect(await player.startTraining({ jutsuId: id })).toMatchObject({
        success: false,
        message: "Jutsu not for you",
      });
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "player") }))
          ?.money,
      ).toBe(1000);
      expect(
        await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, "player") }),
      ).toHaveLength(0);
    }
    await db
      .update(userData)
      .set({ bloodlineReskinId: "group" })
      .where(eq(userData.userId, "player"));
    expect(await player.startTraining({ jutsuId: id })).toMatchObject({
      success: true,
    });
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "player") }))
        ?.money,
    ).toBeLessThan(1000);
    expect(
      await db.query.userJutsu.findFirst({ where: eq(userJutsu.userId, "player") }),
    ).toMatchObject({ jutsuId: id, level: 1 });
  });

  it("searches linked names and retains base-name filtering for unlinked jutsu", async () => {
    const id = await createChild();
    const db = await getTestDatabase();
    await db.update(jutsu).set({ name: "Scarlet attack" }).where(eq(jutsu.id, id));
    await db
      .update(userData)
      .set({ bloodlineId: "blood", bloodlineReskinId: "group" })
      .where(eq(userData.userId, "player"));
    await insertJutsus([
      {
        ...(await read("parent")),
        id: "unlinked",
        name: "Plain attack",
        bloodlineId: null,
      },
    ]);
    await db.insert(userJutsu).values([
      { id: "learned-parent", userId: "player", jutsuId: "parent" },
      { id: "learned-plain", userId: "player", jutsuId: "unlinked" },
    ]);
    for (const name of ["sCaRlEt", "Scarlet attack", "Scar%attack"]) {
      const found = await fetchUserJutsus(db, "player", { name });
      expect(found.map((owned) => owned.jutsuId)).toEqual(["parent"]);
      expect(found[0]?.jutsu.name).toBe("Scarlet attack");
    }
    expect(
      (await fetchUserJutsus(db, "player", { name: "parent" })).map(
        (owned) => owned.jutsuId,
      ),
    ).toEqual(["parent"]);
    expect(
      (await fetchUserJutsus(db, "player", { name: "pLaIn" })).map(
        (owned) => owned.jutsuId,
      ),
    ).toEqual(["unlinked"]);
    expect(await fetchUserJutsus(db, "player", { name: "missing" })).toEqual([]);
    expect(
      await fetchUserJutsus(db, "player", { name: "Scarlet", jutsuType: ["NORMAL"] }),
    ).toEqual([]);
    await db
      .update(userData)
      .set({ bloodlineReskinId: null })
      .where(eq(userData.userId, "player"));
    expect(await fetchUserJutsus(db, "player", { name: "Scarlet" })).toEqual([]);
    expect(
      (await fetchUserJutsus(db, "player", { name: "parent" })).map(
        (owned) => owned.jutsuId,
      ),
    ).toEqual(["parent"]);
  });

  it("searches only the selected variant when a group has multiple variants of one parent", async () => {
    const db = await getTestDatabase();
    const template = await read(await createChild());
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    await db
      .update(jutsu)
      .set({ name: "Older variant", updatedAt: new Date(updatedAt.getTime() - 1000) })
      .where(eq(jutsu.id, template.id));
    await insertJutsus([
      { ...template, id: "variant-a", name: "Selected variant", updatedAt },
      { ...template, id: "variant-b", name: "Unselected variant", updatedAt },
    ]);
    await db
      .update(userData)
      .set({ bloodlineId: "blood", bloodlineReskinId: "group" })
      .where(eq(userData.userId, "player"));
    await db
      .insert(userJutsu)
      .values({ id: "learned-parent", userId: "player", jutsuId: "parent" });
    expect((await fetchUserJutsus(db, "player"))[0]?.jutsu.name).toBe(
      "Selected variant",
    );
    expect(
      (await fetchUserJutsus(db, "player", { name: "Selected variant" })).map(
        (owned) => owned.jutsuId,
      ),
    ).toEqual(["parent"]);
    expect(await fetchUserJutsus(db, "player", { name: "Older variant" })).toEqual([]);
    expect(await fetchUserJutsus(db, "player", { name: "Unselected variant" })).toEqual(
      [],
    );
  });

  it("copies mechanics on creation and parent updates while preserving H rank and cosmetics", async () => {
    const id = await createChild();
    const child = await read(id);
    expect(child.parentJutsuId).toBeNull();
    expect(child.jutsuRank).toBe("H");
    expect(child.hidden).toBe(true);
    const cosmetic = DamageTag.parse({
      ...child.effects[0],
      description: "Scarlet damage",
      staticAnimation: "scarlet-static",
      power: 99,
    });
    expect(
      (
        await save(id, {
          name: "Scarlet attack",
          description: "Custom text",
          effects: [cosmetic],
          cooldown: 299,
        })
      ).success,
    ).toBe(true);
    expect((await read(id)).effects[0]?.power).toBe(4);
    const database = await getTestDatabase();
    const entities = await loadEntities(database, [
      { entityType: "JUTSU", entityId: id },
    ]);
    const version = entities.get(entityKey("JUTSU", id))?.version;
    if (!version) throw new Error("Missing child version");
    await database.insert(contentProposal).values({
      id: "suggestion",
      title: "Child correction",
      rationale: "Improve content",
      category: "GRAMMAR",
      source: "AGENT",
    });
    await database.insert(contentProposalBasis).values({
      proposalId: "suggestion",
      entityType: "JUTSU",
      entityId: id,
      version,
      role: "TARGET",
    });
    expect(
      (
        await save("parent", {
          cooldown: 19,
          chakraCost: 0.2,
          requiredBloodlineMastery: 500,
          effects: [DamageTag.parse({ power: 9 })],
        })
      ).success,
    ).toBe(true);
    const updated = await read(id);
    expect(
      (
        await database.query.contentProposal.findFirst({
          where: eq(contentProposal.id, "suggestion"),
        })
      )?.status,
    ).toBe("OUTDATED");
    expect(updated.cooldown).toBe(19);
    expect(updated.chakraCost).toBe(0.2);
    expect(updated.requiredBloodlineMastery).toBe(500);
    expect(updated.name).toBe("Scarlet attack");
    expect(updated.description).toBe("Custom text");
    expect(updated.effects[0]?.power).toBe(9);
    expect(updated.effects[0]?.staticAnimation).toBe("scarlet-static");
    expect(updated.effects[0]?.description).toBe("Scarlet damage");
    expect(updated.jutsuRank).toBe("H");
    const db = await getTestDatabase();
    const logs = await db.select().from(actionLog).where(eq(actionLog.relatedId, id));
    expect(logs.length).toBe(3);
    const synced = logs.find((log) => log.relatedMsg === "Sync parent: Parent");
    const changes = synced?.changes as string[];
    expect(changes.length).toBe(1);
    expect(JSON.parse(changes[0]!.replace(/^Updated: /, ""))).toEqual({
      cooldown: 19,
      chakraCost: 0.2,
      requiredBloodlineMastery: 500,
      effects: { 0: { power: 9 } },
    });
  });

  it("validates ordinary required items and inherits the linked parent's item", async () => {
    expect(await save("parent", { requiredBloodlineItemId: "missing" })).toMatchObject({
      success: false,
      message: "Required bloodline item not found",
    });
    await insertItems([
      { id: "parent-item", bloodlineId: "blood" },
      { id: "other-item", bloodlineId: "other" },
    ]);
    expect(
      await save("parent", { requiredBloodlineItemId: "other-item" }),
    ).toMatchObject({
      success: false,
      message: "The required bloodline item must belong to the jutsu's bloodline",
    });
    expect(
      (await save("parent", { requiredBloodlineItemId: "parent-item" })).success,
    ).toBe(true);
    const id = await createChild();
    expect((await read(id)).requiredBloodlineItemId).toBe("parent-item");
    expect(
      (
        await save(id, {
          requiredBloodlineItemId: "missing",
          description: "Custom cosmetics",
        })
      ).success,
    ).toBe(true);
    expect(await read(id)).toMatchObject({
      requiredBloodlineItemId: "parent-item",
      description: "Custom cosmetics",
    });
  });

  it("unequips only the edited jutsu when it is saved as hidden", async () => {
    const db = await getTestDatabase();
    await insertJutsus([{ ...(await read("parent")), id: "other", name: "Other" }]);
    await db.insert(userJutsu).values([
      { id: "owned-parent", userId: "player", jutsuId: "parent", equipped: true },
      { id: "owned-other", userId: "player", jutsuId: "other", equipped: true },
    ]);
    expect((await save("parent", { hidden: false })).success).toBe(true);
    expect(
      (await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-parent") }))
        ?.equipped,
    ).toBe(true);
    expect((await save("parent", { hidden: true })).success).toBe(true);
    expect(
      (await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-parent") }))
        ?.equipped,
    ).toBe(false);
    expect(
      (await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned-other") }))
        ?.equipped,
    ).toBe(true);
  });

  it("rejects player creation, self links, nested links, evolution links and mismatched groups", async () => {
    expect(
      (
        await (
          await callerFor(jutsuRouter, "player")
        ).createLinkedReskin({ parentId: "parent", bloodlineReskinId: "group" })
      ).success,
    ).toBe(false);
    const id = await createChild();
    expect((await save(id, { reskinParentJutsuId: id })).success).toBe(false);
    expect(
      (
        await (
          await staff()
        ).createLinkedReskin({ parentId: id, bloodlineReskinId: "group" })
      ).success,
    ).toBe(false);
    expect((await save(id, { parentJutsuId: "parent" })).success).toBe(false);
    expect((await save(id, { reskinParentJutsuId: "missing" })).success).toBe(false);
    expect((await save(id, { bloodlineReskinId: "missing" })).success).toBe(false);
    expect((await save("parent", { reskinParentJutsuId: id })).success).toBe(false);
    expect((await save("parent", { jutsuRank: "H" })).success).toBe(false);
    expect((await save("parent", { bloodlineId: "other" })).success).toBe(false);
  });

  it("rejects reskin evolution parents and preserves cosmetic editing and ordinary evolution", async () => {
    const id = await createChild();
    await insertJutsus([
      { ...(await read("parent")), id: "evolution", name: "Evolution" },
    ]);

    expect(await save("evolution", { parentJutsuId: id })).toMatchObject({
      success: false,
      message: "Reskins cannot be evolution parents",
    });
    expect((await read("evolution")).parentJutsuId).toBeNull();
    expect((await save(id, { description: "Updated cosmetics" })).success).toBe(true);
    expect((await read(id)).description).toBe("Updated cosmetics");
    expect((await save("evolution", { parentJutsuId: "parent" })).success).toBe(true);
    expect((await read("evolution")).parentJutsuId).toBe("parent");
  });

  it.each(["reskin", "evolution"] as const)(
    "rejects a stale overlapping save when the %s link commits first",
    async (firstLink) => {
      const db = await getTestDatabase();
      await insertJutsus([
        { ...(await read("parent")), id: "candidate", name: "Candidate" },
        { ...(await read("parent")), id: "evolution", name: "Evolution" },
      ]);
      const paused = pauseBeforeTransaction(db);
      const caller = callerForDatabase(jutsuRouter, "staff", paused.client);
      const pausedId = firstLink === "reskin" ? "evolution" : "candidate";
      const pausedPatch =
        firstLink === "reskin"
          ? { parentJutsuId: "candidate" }
          : { reskinParentJutsuId: "parent" };
      const pending = caller.update({
        id: pausedId,
        data: JutsuValidator.parse({ ...(await read(pausedId)), ...pausedPatch }),
      });
      await paused.reached;
      try {
        const winner =
          firstLink === "reskin"
            ? await save("candidate", { reskinParentJutsuId: "parent" })
            : await save("evolution", { parentJutsuId: "candidate" });
        expect(winner.success).toBe(true);
      } finally {
        paused.release();
      }
      expect(await pending).toMatchObject({
        success: false,
        message:
          firstLink === "reskin"
            ? "Reskins cannot be evolution parents"
            : "Reskins cannot have evolution links or reskin children",
      });
      expect((await read("candidate")).reskinParentJutsuId).toBe(
        firstLink === "reskin" ? "parent" : null,
      );
      expect((await read("evolution")).parentJutsuId).toBe(
        firstLink === "evolution" ? "candidate" : null,
      );
      expect(
        (await db.select().from(actionLog).where(eq(actionLog.relatedId, pausedId)))
          .length,
      ).toBe(0);
      expect(
        (await save("candidate", { description: "Updated cosmetics" })).success,
      ).toBe(true);
      expect((await read("candidate")).description).toBe("Updated cosmetics");
      expect((await save("evolution", { parentJutsuId: "parent" })).success).toBe(true);
    },
  );

  it("blocks parent and group deletion until the child is unlinked", async () => {
    const id = await createChild();
    expect((await (await staff()).delete({ id: "parent" })).success).toBe(false);
    expect(
      (
        await (
          await callerFor(bloodlineRouter, "staff")
        ).deleteReskin({ reskinId: "group" })
      ).success,
    ).toBe(false);
    expect(
      (await save(id, { reskinParentJutsuId: null, bloodlineReskinId: null })).success,
    ).toBe(true);
    expect((await save("parent", { cooldown: 18 })).success).toBe(true);
    expect((await read(id)).cooldown).toBe(0);
    expect((await (await staff()).delete({ id: "parent" })).success).toBe(true);
    expect(
      (
        await (
          await callerFor(bloodlineRouter, "staff")
        ).deleteReskin({ reskinId: "group" })
      ).success,
    ).toBe(true);
  });

  it.each([
    { clock: "same millisecond", offsets: [0, 0, 0] },
    { clock: "regressed", offsets: [1000, 2000, 3000] },
  ])(
    "advances every family version with a $clock clock and rejects an overlapping child save",
    async ({ offsets }) => {
      const db = await getTestDatabase();
      const childId = await createChild();
      const otherChildId = await createChild();
      const ids = ["parent", childId, otherChildId];
      const now = new Date("2030-01-01T12:00:00Z");
      const versions = offsets.map((offset) => new Date(now.getTime() + offset));
      await Promise.all(
        ids.map((id, index) =>
          db.update(jutsu).set({ updatedAt: versions[index] }).where(eq(jutsu.id, id)),
        ),
      );
      const paused = pauseBeforeTransaction(db);
      const caller = callerForDatabase(jutsuRouter, "staff", paused.client);
      const pending = caller.update({
        id: childId,
        data: JutsuValidator.parse({
          ...(await read(childId)),
          description: "Stale cosmetics",
        }),
      });
      await paused.reached;
      setSystemTime(now);
      try {
        const saved = await save("parent", { cooldown: 23 });
        paused.release();
        const stale = await pending;
        expect(saved.success).toBe(true);
        expect(stale).toMatchObject({
          success: false,
          message: "Jutsu changed; refresh before saving",
        });
        const family = await Promise.all(ids.map(read));
        const expectedVersion =
          Math.max(...versions.map((version) => version.getTime())) + 1;
        expect(family.map((row) => row.updatedAt.getTime())).toEqual(
          ids.map(() => expectedVersion),
        );
        expect(await read(childId)).toMatchObject({
          cooldown: 23,
          description: "Parent text",
        });
        expect(
          (await db.select().from(actionLog).where(eq(actionLog.relatedId, childId)))
            .length,
        ).toBe(2);
      } finally {
        setSystemTime();
        paused.release();
      }
    },
  );

  it("serializes simultaneous child creation and parent saves without stale mechanics", async () => {
    const [created, saved] = await Promise.all([
      (await staff()).createLinkedReskin({
        parentId: "parent",
        bloodlineReskinId: "group",
      }),
      save("parent", { cooldown: 21, chakraCost: 0.25 }),
    ]);
    expect(created.success).toBe(true);
    expect(saved.success).toBe(true);
    const child = await read(created.message);
    expect(child.cooldown).toBe(21);
    expect(child.chakraCost).toBe(0.25);
  });
});
