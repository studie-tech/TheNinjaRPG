// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { updateUserPreferencesSchema } from "@/validators/user";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "gap99-tutorial-user";
const caller = () => callerFor(profileRouter, USER_ID);
const durableRequest = (requestId: string) => ({
  tutorialOn: false as const,
  expectedTutorialOn: true as const,
  requestId,
});

describe("profile.updatePreferences durable tutorial contract", () => {
  it("requires the UUID, prior value, and next value together", () => {
    expect(() =>
      updateUserPreferencesSchema.parse({
        tutorialOn: false,
        requestId: "99000000-0000-4000-8000-000000000001",
      }),
    ).toThrow(/expected tutorial preference/i);
    expect(() =>
      updateUserPreferencesSchema.parse({
        expectedTutorialOn: true,
        requestId: "99000000-0000-4000-8000-000000000001",
      }),
    ).toThrow(/include the tutorial preference/i);
    expect(() =>
      updateUserPreferencesSchema.parse({
        tutorialOn: false,
        expectedTutorialOn: true,
        requestId: "99000000-0000-4000-8000-000000000001",
        musicOn: false,
      }),
    ).toThrow(/cannot update other preferences/i);
  });

  it("keeps the legacy partial-preference input valid", () => {
    expect(
      updateUserPreferencesSchema.parse({
        musicOn: false,
        sfxOn: false,
        preferredGeneral1: "Strength",
      }),
    ).toMatchObject({ musicOn: false, sfxOn: false });
  });
});

describeWithDatabase("profile.updatePreferences", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData);
    await insertUsers([
      {
        userId: USER_ID,
        username: "Gap99 Tutorial User",
        tutorialOn: true,
        musicOn: true,
        sfxOn: true,
      },
    ]);
  });

  it("preserves legacy caller behavior without creating a durable receipt", async () => {
    const database = await getTestDatabase();
    const api = await caller();
    const result = await api.updatePreferences({ musicOn: false, sfxOn: false });
    const stored = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });

    expect(result).toEqual({ success: true, message: "Updated preferences" });
    expect(stored).toMatchObject({
      tutorialOn: true,
      musicOn: false,
      sfxOn: false,
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("atomically disables the expected tutorial preference and returns an exact receipt", async () => {
    const database = await getTestDatabase();
    const api = await caller();
    const input = durableRequest("99000000-0000-4000-8000-000000000002");
    const result = await api.updatePreferences(input);
    const stored = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    const receipt = await database.query.actionLog.findFirst({
      where: eq(actionLog.id, `tutorial-preference:${input.requestId}`),
    });

    expect(result).toEqual({
      success: true,
      message: "Updated preferences",
      requestId: input.requestId,
      userId: USER_ID,
      expectedTutorialOn: true,
      committedTutorialOn: false,
    });
    expect(stored).toMatchObject({
      tutorialOn: false,
      musicOn: true,
      sfxOn: true,
    });
    expect(receipt).toMatchObject({
      userId: USER_ID,
      tableName: "UserData",
      changes: ["tutorialOn:true->false"],
      relatedId: USER_ID,
      relatedMsg: "Tutorial preference",
      relatedValue: 0,
    });
  });

  it("replays an identical lost response and rejects changed UUID reuse", async () => {
    const database = await getTestDatabase();
    const api = await caller();
    const input = durableRequest("99000000-0000-4000-8000-000000000003");

    const first = await api.updatePreferences(input);
    const replay = await api.updatePreferences(input);
    const collision = await api.updatePreferences({
      ...input,
      tutorialOn: true,
    });

    expect(first.success).toBe(true);
    expect(replay).toEqual({
      ...first,
      message: "Tutorial preference was already updated",
    });
    expect(collision).toEqual({
      success: false,
      message: "Invalid tutorial preference request ID",
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("rejects an old receipt replay after the tutorial is re-enabled", async () => {
    const database = await getTestDatabase();
    const api = await caller();
    const input = durableRequest("99000000-0000-4000-8000-000000000008");

    const committed = await api.updatePreferences(input);
    await api.updatePreferences({ tutorialOn: true });
    const staleReplay = await api.updatePreferences(input);
    const stored = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });

    expect(committed.success).toBe(true);
    expect(staleReplay).toEqual({
      success: false,
      message: "Your tutorial preference changed after this request was saved",
    });
    expect(stored?.tutorialOn).toBe(true);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });

  it("does not overwrite a concurrent preference change", async () => {
    const database = await getTestDatabase();
    const api = await caller();
    await database
      .update(userData)
      .set({ tutorialOn: false })
      .where(eq(userData.userId, USER_ID));

    const stale = await api.updatePreferences(
      durableRequest("99000000-0000-4000-8000-000000000004"),
    );

    expect(stale).toEqual({
      success: false,
      message: "Your tutorial preference changed; review it before trying again",
    });
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("rolls the preference back if its durable receipt cannot be written", async () => {
    const database = await getTestDatabase();
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return <T>(callback: (tx: DrizzleClient) => Promise<T>) =>
            target.transaction((tx) =>
              callback(failStatements(tx as unknown as DrizzleClient, actionLog)),
            );
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DrizzleClient;
    const api = callerForDatabase(profileRouter, USER_ID, failingDatabase);

    await expect(
      api.updatePreferences(
        durableRequest("99000000-0000-4000-8000-000000000007"),
      ),
    ).rejects.toThrow("Statement failed on purpose");

    const stored = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    expect(stored?.tutorialOn).toBe(true);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("allows only one of two concurrent stale dismissals to commit", async () => {
    const database = await getTestDatabase();
    const api = await caller();
    const [first, second] = await Promise.all([
      api.updatePreferences(
        durableRequest("99000000-0000-4000-8000-000000000005"),
      ),
      api.updatePreferences(
        durableRequest("99000000-0000-4000-8000-000000000006"),
      ),
    ]);

    expect([first.success, second.success].sort()).toEqual([false, true]);
    const stored = await database.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    expect(stored?.tutorialOn).toBe(false);
    expect(await database.query.actionLog.findMany()).toHaveLength(1);
  });
});
