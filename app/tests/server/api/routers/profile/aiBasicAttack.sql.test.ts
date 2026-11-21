import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, jutsu, userData, userJutsu } from "@/drizzle/schema";
import { loadEntities } from "@/libs/contentReview/entities";
import * as socials from "@/libs/socials";
import { profileRouter } from "@/server/api/routers/profile";
import { insertAiSchema } from "@/validators/aiInput";
import { insertJutsus, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const AI = "replacement-ai";
const EDITOR = "replacement-editor";

describeWithDatabase("AI Basic Attack Replacement persistence", () => {
  beforeEach(async () => {
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await resetTables(actionLog, userData, userJutsu, jutsu);
    await insertUsers([
      { userId: EDITOR, username: EDITOR, role: "CONTENT-ADMIN" },
      { userId: AI, username: AI, isAi: true },
    ]);
    await insertJutsus([{ id: "strike", name: "Replacement Strike" }]);
  });
  afterEach(() => vi.restoreAllMocks());

  const save = async (replacement: string | null | undefined, equipped: string[]) => {
    const db = await getTestDatabase();
    const row = await db.query.userData.findFirst({ where: eq(userData.userId, AI) });
    const caller = await callerFor(profileRouter, EDITOR);
    return caller.updateAi({
      id: AI,
      data: insertAiSchema.parse({
        ...row,
        basicAttackJutsuId: replacement,
        jutsus: equipped,
        items: [],
      }),
    });
  };

  it("saves, logs, clones and includes the setting in content-review snapshots", async () => {
    expect(await save("strike", ["strike"])).toMatchObject({ success: true });
    const db = await getTestDatabase();
    const entities = await loadEntities(db, [{ entityType: "AI", entityId: AI }]);
    expect(entities.get(`AI:${AI}`)?.editable.basicAttackJutsuId).toBe("strike");
    expect(JSON.stringify((await db.query.actionLog.findFirst())?.changes)).toContain(
      "basicAttackJutsuId",
    );
    const cloned = await (await callerFor(profileRouter, EDITOR)).cloneAi({ id: AI });
    expect(cloned.success).toBe(true);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, cloned.message) }),
    ).toMatchObject({ basicAttackJutsuId: "strike" });
    expect(
      await db.query.userJutsu.findFirst({
        where: eq(userJutsu.userId, cloned.message),
      }),
    ).toMatchObject({ jutsuId: "strike", equipped: true });
  });

  it("can clear the replacement and unequip it together", async () => {
    await save("strike", ["strike"]);
    expect(await save(null, [])).toMatchObject({ success: true });
    const db = await getTestDatabase();
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, AI) }),
    ).toMatchObject({ basicAttackJutsuId: null });
    expect(
      await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, AI) }),
    ).toHaveLength(0);
  });

  it("guards the saved replacement when an editor omits the setting", async () => {
    await save("strike", ["strike"]);
    expect(await save(undefined, [])).toMatchObject({ success: false });
    const db = await getTestDatabase();
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, AI) }),
    ).toMatchObject({ basicAttackJutsuId: "strike" });
    expect(
      await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, AI) }),
    ).toHaveLength(1);
    expect(await save(undefined, ["strike"])).toMatchObject({ success: true });
  });

  it("rejects nonexistent content before changing the equipped loadout or writing logs", async () => {
    expect(await save("deleted", ["deleted"])).toMatchObject({
      success: false,
      message: "Basic Attack Replacement Jutsu no longer exists",
    });
    const db = await getTestDatabase();
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
    expect(await db.query.userJutsu.findMany()).toHaveLength(0);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, AI) }),
    ).toMatchObject({ basicAttackJutsuId: null });
  });
});
