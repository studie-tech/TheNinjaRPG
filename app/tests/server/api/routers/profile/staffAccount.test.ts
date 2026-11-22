import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import type { UserRole } from "@/drizzle/constants";
import { UserRoles } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const ADMIN_ROLES: readonly UserRole[] = [
  "OWNER",
  "CODING-ADMIN",
  "CONTENT-ADMIN",
  "EVENT-ADMIN",
  "MODERATOR-ADMIN",
];

describeWithDatabase("public profile staff-account privacy", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(userData);
    await insertUsers([
      { userId: "target", username: "Target", staffAccount: true, avatarLight: "" },
      { userId: "viewer", username: "Viewer", staffAccount: true, avatarLight: "" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(UserRoles)(
    "limits the flag to editing admins for a %s viewer",
    async (role) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ role })
        .where(eq(userData.userId, "viewer"));
      const caller = await callerFor(profileRouter, "viewer");
      for (const staffAccount of [false, true]) {
        for (const showPvpRecord of [false, true]) {
          await database
            .update(userData)
            .set({ staffAccount, showPvpRecord })
            .where(eq(userData.userId, "target"));
          const profile = await caller.getPublicUser({ userId: "target" });
          expect(profile).not.toBeNull();
          if (ADMIN_ROLES.includes(role)) {
            expect(profile).toHaveProperty("staffAccount", staffAccount);
          } else {
            expect(profile).not.toHaveProperty("staffAccount");
          }
        }
      }
    },
  );

  it.each([null, "target"])(
    "omits the flag for signed-out and non-admin self views (%p)",
    async (viewer) => {
      const caller = profileRouter.createCaller({
        drizzle: await getTestDatabase(),
        userId: viewer,
        userIp: "127.0.0.1",
        userCountry: undefined,
        userAgent: undefined,
        wallpaperVariant: undefined,
      });
      const profile = await caller.getPublicUser({ userId: "target" });
      expect(profile).not.toBeNull();
      expect(profile).not.toHaveProperty("staffAccount");
    },
  );
});
