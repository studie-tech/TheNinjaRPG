// @vitest-environment node
//
// A device token becomes ctx.userId like any other session, so without this
// guard the desktop client's long-lived on-disk token would authenticate every
// protectedProcedure in the app — items, bank, clan — not just its own router.
import { describe, expect, it } from "vitest";
import { isDeviceTokenPathAllowed } from "@/server/api/trpc";

describe("device token scope", () => {
  it("allows the contribution router", () => {
    for (const path of [
      "devContribution.claimNextJob",
      "devContribution.completeJob",
      "devContribution.heartbeat",
      "devContribution.getLeaderboard",
    ]) {
      expect(isDeviceTokenPathAllowed(path)).toBe(true);
    }
  });

  it("denies every other router", () => {
    for (const path of [
      "profile.getUser",
      "bank.deposit",
      "item.buy",
      "clan.leaveClan",
      "combat.performAction",
    ]) {
      expect(isDeviceTokenPathAllowed(path)).toBe(false);
    }
  });

  it("is not satisfied by a router merely prefixed with the name", () => {
    // The trailing dot is what makes this a router boundary rather than a
    // string prefix; "devContributionAdmin" must not inherit the grant.
    expect(isDeviceTokenPathAllowed("devContributionAdmin.grantMoney")).toBe(false);
    expect(isDeviceTokenPathAllowed("devContribution")).toBe(false);
  });

  it("is not satisfied by the name appearing later in the path", () => {
    expect(isDeviceTokenPathAllowed("evil.devContribution.claimNextJob")).toBe(false);
  });
});
