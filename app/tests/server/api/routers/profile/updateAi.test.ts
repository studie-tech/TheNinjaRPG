import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, jutsu, userData, userJutsu } from "@/drizzle/schema";
import * as socials from "@/libs/socials";
import { profileRouter } from "@/server/api/routers/profile";
import type { InsertAiSchemaInput } from "@/validators/aiInput";
import { insertJutsus, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const EDITOR = "ai-editor";
const AI = "ai-target";
const PLAYER = "ai-player";

// The full AI row as the edit form submits it, with jutsus and the requested patch applied.
const editData = async (patch: Partial<InsertAiSchemaInput>) => {
  const database = await getTestDatabase();
  const [ai] = await database.select().from(userData).where(eq(userData.userId, AI));
  return { ...ai, effects: [], jutsus: [], items: [], ...patch } as InsertAiSchemaInput;
};

const aiState = async () => {
  const database = await getTestDatabase();
  const [[ai], jutsus] = await Promise.all([
    database.select().from(userData).where(eq(userData.userId, AI)),
    database.select().from(userJutsu).where(eq(userJutsu.userId, AI)),
  ]);
  return { username: ai?.username, jutsuIds: jutsus.map((j) => j.jutsuId) };
};

describeWithDatabase("profile.updateAi username uniqueness", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await resetTables(actionLog, userJutsu, jutsu, userData);
    await insertUsers([
      { userId: EDITOR, username: "AiEditor", role: "CODING-ADMIN" },
      { userId: AI, username: "Guardian Bot", isAi: true, level: 10 },
      { userId: PLAYER, username: "Guardian", role: "USER" },
    ]);
    await insertJutsus([{ id: "ai-jutsu", name: "AI Jutsu", requiredRank: "GENIN" }]);
  });

  it("rejects a username another user has before writing anything", async () => {
    const caller = await callerFor(profileRouter, EDITOR);
    const result = await caller.updateAi({
      id: AI,
      data: await editData({ username: "Guardian", jutsus: ["ai-jutsu"] }),
    });
    expect(result).toMatchObject({ success: false, message: "Username already taken" });
    expect(await aiState()).toEqual({ username: "Guardian Bot", jutsuIds: [] });
    const database = await getTestDatabase();
    expect(await database.select().from(actionLog)).toHaveLength(0);
  });

  it("allows saving an AI under its own current username", async () => {
    const caller = await callerFor(profileRouter, EDITOR);
    const result = await caller.updateAi({
      id: AI,
      data: await editData({ username: "Guardian Bot", jutsus: ["ai-jutsu"] }),
    });
    expect(result.success).toBe(true);
    expect(await aiState()).toEqual({
      username: "Guardian Bot",
      jutsuIds: ["ai-jutsu"],
    });
  });
});
