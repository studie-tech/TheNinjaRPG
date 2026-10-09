// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { historicalAvatar, userData } from "@/drizzle/schema";
import { avatarRouter } from "@/server/api/routers/avatar";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

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
    const caller = await callerFor(avatarRouter, userId);
    const result = await caller.updateAvatar({ avatar: 11, type: "user" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ avatar, avatarLight });
    const saved = await database.query.userData.findFirst({
      columns: { avatar: true, avatarLight: true },
      where: eq(userData.userId, userId),
    });
    expect(result.data).toEqual(saved);
  });

  it("does not supply a user patch when history is missing", async () => {
    const caller = await callerFor(avatarRouter, userId);
    const result = await caller.updateAvatar({ avatar: 99, type: "user" });
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
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
    expect(result.data).toBeUndefined();
  });
});
