import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userItem, userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers, insertItems, insertUserItems } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("public PvP record visibility", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(userItem, item, userData);
    await insertUsers([
      {
        userId: "owner",
        username: "Owner",
        role: "USER",
        pvpWins: 3,
        pvpLosses: 2,
        showPvpRecord: false,
        avatarLight: "",
      },
      { userId: "viewer", username: "Viewer", role: "USER", avatarLight: "" },
      { userId: "staff", username: "Staff", role: "OWNER", avatarLight: "" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["viewer", "signed-out"])("does not expose private furniture placements through public profiles to %s", async (viewer) => {
    await insertItems([{ id: "private-chair", name: "Private chair", itemType: "FURNITURE" }]);
    await insertUserItems([{ id: "private-placement", userId: "owner", itemId: "private-chair", homeX: 50, homeY: 50, homeRoom: "main" }]);
    const result = await (await callerFor(profileRouter, viewer)).getPublicUser({ userId: "owner" });
    expect(result?.items).toEqual([]);
  });

  it.each(["viewer", "signed-out"])("hides private records from %s", async (viewer) => {
    const profile = await (await callerFor(profileRouter, viewer)).getPublicUser({
      userId: "owner",
    });
    expect(profile?.pvpWins).toBeNull();
    expect(profile?.pvpLosses).toBeNull();
  });

  it.each(["owner", "staff"])("allows %s to see a private record", async (viewer) => {
    const profile = await (await callerFor(profileRouter, viewer)).getPublicUser({
      userId: "owner",
    });
    expect(profile?.pvpWins).toBe(3);
    expect(profile?.pvpLosses).toBe(2);
  });

  it("publishes the record only after its owner opts in", async () => {
    expect(await (await callerFor(profileRouter, "owner")).updatePreferences({ showPvpRecord: true })).toMatchObject({ success: true, userPatch: { showPvpRecord: true } });
    const profile = await (await callerFor(profileRouter, "viewer")).getPublicUser({
      userId: "owner",
    });
    expect(profile?.pvpWins).toBe(3);
    expect(profile?.pvpLosses).toBe(2);
    expect(
      (
        await (
          await getTestDatabase()
        ).query.userData.findFirst({ where: eq(userData.userId, "owner") })
      )?.showPvpRecord,
    ).toBe(true);
  });
});
