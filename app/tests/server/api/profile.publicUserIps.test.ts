// @vitest-environment node

import { beforeEach, expect, it } from "vitest";
import { userData } from "@/drizzle/schema";
import type { GetPublicUsersSchema } from "@/validators/user";
import { fetchPublicUsers } from "../../../src/server/api/routers/profile";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

/**
 * `fetchPublicUsers` decides whether to reveal players' IPs from the caller's own role, which it
 * reads back from the database. It selects only the `role` column to do so - this suite runs the
 * guard against a real MySQL, so a projection that stopped carrying the field, or stopped
 * matching the caller's row at all, shows up as staff losing IPs rather than as a green build.
 */
const listing: GetPublicUsersSchema = {
  limit: 10,
  isAi: false,
  orderBy: "Strongest",
};

const lastIpsSeenBy = async (userId: string | undefined) => {
  const result = await fetchPublicUsers({
    client: await getTestDatabase(),
    input: listing,
    userId,
  });
  return result.data.map((u) => u.lastIp);
};

describeWithDatabase("fetchPublicUsers IP visibility", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "staff", username: "staff", role: "OWNER", lastIp: "10.0.0.1" },
      { userId: "player", username: "player", role: "USER", lastIp: "10.0.0.2" },
      { userId: "proxied", username: "proxied", role: "USER", lastIp: null },
    ]);
  });

  it("shows real IPs to a role that may see them", async () => {
    expect((await lastIpsSeenBy("staff")).sort()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "Proxied",
    ]);
  });

  it("hides every IP from an ordinary player", async () => {
    expect(await lastIpsSeenBy("player")).toEqual(["hidden", "hidden", "hidden"]);
  });

  it("hides every IP from a signed-out caller", async () => {
    expect(await lastIpsSeenBy(undefined)).toEqual(["hidden", "hidden", "hidden"]);
  });

  it("refuses an IP search from a role that may not see IPs", async () => {
    await expect(
      fetchPublicUsers({
        client: await getTestDatabase(),
        input: { ...listing, ip: "10.0.0.1" },
        userId: "player",
      }),
    ).rejects.toThrow(/not allowed to search IPs/);
  });

  it("allows an IP search from a role that may see them", async () => {
    const result = await fetchPublicUsers({
      client: await getTestDatabase(),
      input: { ...listing, ip: "10.0.0.1" },
      userId: "staff",
    });
    expect(result.data.map((u) => u.username)).toEqual(["staff"]);
  });
});
