import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, bloodlineReskin, contentProposal, contentProposalBasis, jutsu, userData, userJutsu } from "@/drizzle/schema";
import { loadEntities, entityKey } from "@/libs/contentReview/entities";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { DamageTag, JutsuValidator } from "@/validators/combat";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const staff = () => callerFor(jutsuRouter, "staff");
const read = async (id: string) => {
  const db = await getTestDatabase();
  const [row] = await db.select().from(jutsu).where(eq(jutsu.id, id));
  if (!row) throw new Error(`Missing fixture ${id}`);
  return row;
};
const save = async (id: string, patch: Record<string, unknown> = {}) =>
  (await staff()).update({ id, data: JutsuValidator.parse({ ...await read(id), ...patch }) });
const createChild = async () => {
  const result = await (await staff()).createLinkedReskin({ parentId: "parent", bloodlineReskinId: "group" });
  expect(result.success).toBe(true);
  return result.message;
};

describeWithDatabase("linked H-rank jutsu against real MySQL", () => {
  beforeEach(async () => {
    await resetTables(contentProposalBasis, contentProposal, actionLog, userJutsu, jutsu, bloodlineReskin, userData);
    await insertUsers([{ userId: "staff", username: "Staff", role: "CONTENT" }, { userId: "player", username: "Player" }] as never);
    const db = await getTestDatabase();
    await db.insert(jutsu).values({
      id: "parent", name: "Parent", image: "/parent.png", description: "Parent text", battleDescription: "Parent battle",
      effects: [DamageTag.parse({power: 4, appearAnimation: "appear", appearSfx: "sound"})],
      range: 1, target: "OTHER_USER", requiredRank: "GENIN", jutsuType: "BLOODLINE", bloodlineId: "blood", hidden: true,
    });
    await db.insert(bloodlineReskin).values({ id: "group", bloodlineId: "blood", name: "Scarlet", description: "Scarlet", image: "/scarlet.png", createdBy: "staff" });
  });

  it("copies mechanics on creation and parent updates while preserving H rank and cosmetics", async () => {
    const id = await createChild();
    const child = await read(id);
    expect(child.parentJutsuId).toBeNull();
    expect(child.jutsuRank).toBe("H");
    expect(child.hidden).toBe(true);
    const cosmetic = DamageTag.parse({ ...child.effects[0], description: "Scarlet damage", staticAnimation: "scarlet-static", power: 99 });
    expect((await save(id, { name: "Scarlet attack", description: "Custom text", effects: [cosmetic], cooldown: 299 })).success).toBe(true);
    expect((await read(id)).effects[0]?.power).toBe(4);
    const database = await getTestDatabase();
    const entities = await loadEntities(database, [{entityType: "JUTSU", entityId: id}]);
    const version = entities.get(entityKey("JUTSU", id))?.version;
    if (!version) throw new Error("Missing child version");
    await database.insert(contentProposal).values({id: "suggestion", title: "Child correction", rationale: "Improve content", category: "GRAMMAR", source: "AGENT"});
    await database.insert(contentProposalBasis).values({proposalId: "suggestion", entityType: "JUTSU", entityId: id, version, role: "TARGET"});
    expect((await save("parent", { cooldown: 19, chakraCost: 0.2, requiredBloodlineMastery: 500, effects: [DamageTag.parse({ power: 9 })] })).success).toBe(true);
    const updated = await read(id);
    expect((await database.query.contentProposal.findFirst({where: eq(contentProposal.id, "suggestion")}))?.status).toBe("OUTDATED");
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
    expect((await db.select().from(actionLog).where(eq(actionLog.relatedId, id))).length).toBe(3);
  });

  it("rejects player creation, self links, nested links, evolution links and mismatched groups", async () => {
    expect((await (await callerFor(jutsuRouter, "player")).createLinkedReskin({ parentId: "parent", bloodlineReskinId: "group" })).success).toBe(false);
    const id = await createChild();
    expect((await save(id, { reskinParentJutsuId: id })).success).toBe(false);
    expect((await (await staff()).createLinkedReskin({ parentId: id, bloodlineReskinId: "group" })).success).toBe(false);
    expect((await save(id, { parentJutsuId: "parent" })).success).toBe(false);
    expect((await save(id, { reskinParentJutsuId: "missing" })).success).toBe(false);
    expect((await save(id, { bloodlineReskinId: "missing" })).success).toBe(false);
    expect((await save("parent", { reskinParentJutsuId: id })).success).toBe(false);
    expect((await save("parent", { jutsuRank: "H" })).success).toBe(false);
    expect((await save("parent", { bloodlineId: "other" })).success).toBe(false);
  });

  it("blocks parent and group deletion until the child is unlinked", async () => {
    const id = await createChild();
    expect((await (await staff()).delete({ id: "parent" })).success).toBe(false);
    expect((await (await callerFor(bloodlineRouter, "staff")).deleteReskin({reskinId: "group"})).success).toBe(false);
    expect((await save(id, { reskinParentJutsuId: null, bloodlineReskinId: null })).success).toBe(true);
    expect((await save("parent", {cooldown: 18})).success).toBe(true);
    expect((await read(id)).cooldown).toBe(0);
    expect((await (await staff()).delete({ id: "parent" })).success).toBe(true);
    expect((await (await callerFor(bloodlineRouter, "staff")).deleteReskin({reskinId: "group"})).success).toBe(true);
  });

  it("serializes simultaneous child creation and parent saves without stale mechanics", async () => {
    const [created, saved] = await Promise.all([
      (await staff()).createLinkedReskin({ parentId: "parent", bloodlineReskinId: "group" }),
      save("parent", { cooldown: 21, chakraCost: 0.25 }),
    ]);
    expect(created.success).toBe(true);
    expect(saved.success).toBe(true);
    const child = await read(created.message);
    expect(child.cooldown).toBe(21);
    expect(child.chakraCost).toBe(0.25);
  });
});
