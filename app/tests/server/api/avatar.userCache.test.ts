// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { historicalAvatar, userData } from "@/drizzle/schema";
import { avatarRouter } from "@/server/api/routers/avatar";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

import { countUserReads } from "../../setup/userReads";

const userId = "avatar-cache-user";
const avatar = "https://example.com/cache-avatar.png";
const avatarLight = "https://example.com/cache-avatar-thumb.png";

describeWithDatabase("Avatar cache reconciliation", () => {
  beforeEach(async () => {
    await resetTables(historicalAvatar, userData);
    await insertUsers([{ userId, username: "AvatarCache" } as never]);
  });

  it("returns the saved avatar and thumbnail together without generating either", async () => {
    const database = await getTestDatabase();
    await database.insert(historicalAvatar).values({
      id: 11,
      userId,
      avatar,
      avatarLight,
      done: true,
      status: "success",
    });
    const counted = countUserReads(database);
    const caller = callerForDatabase(avatarRouter, userId, counted.client);
    const result = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(counted.getReads()).toBe(1);
    expect(result.success).toBe(true);
    expect(result.userPatch).toEqual({ avatar, avatarLight });
    const saved = await database.query.userData.findFirst({
      columns: { avatar: true, avatarLight: true },
      where: eq(userData.userId, userId),
    });
    expect(result.userPatch).toEqual(saved);
    expect(counted.getUserWrites()).toBe(1);
    // Selecting the active pair succeeds without relying on driver no-op row counts.
    const repeated = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(repeated.success).toBe(true);
    expect(repeated.userPatch).toEqual({ avatar, avatarLight });
    expect(counted.getReads()).toBe(2);
    expect(counted.getUserWrites()).toBe(1);
  });

  it("does not supply a user patch when history is missing", async () => {
    const caller = await callerFor(avatarRouter, userId);
    const result = await caller.updateAvatar({ avatar: 99, type: "user" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
  });

  it("does not supply a user patch when the avatar belongs to another player", async () => {
    const database = await getTestDatabase();
    await database.insert(historicalAvatar).values({
      id: 11,
      userId: "other-avatar-user",
      avatar,
      avatarLight,
      done: true,
      status: "success",
    });
    const caller = await callerFor(avatarRouter, userId);
    const result = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
  });
});
