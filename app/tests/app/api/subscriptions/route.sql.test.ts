import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/subscriptions/route";
import { paypalSubscription, storePurchase, stripePayment, userData } from "@/drizzle/schema";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

/** Transient provider failures must not masquerade as confirmed subscription termination. */
describeWithDatabase("PayPal renewal lookup failures", () => {
  beforeEach(async () => {
    await resetTables(paypalSubscription, storePurchase, stripePayment, userData);
    await insertUsers([{ userId: "renewal-buyer", username: "RenewalBuyer", federalStatus: "GOLD" }]);
    await (await getTestDatabase()).insert(paypalSubscription).values({
      id: "due-subscription", subscriptionId: "I-DUE", orderId: "I-DUE", createdById: "renewal-buyer", affectedUserId: "renewal-buyer", federalStatus: "GOLD", status: "ACTIVE", updatedAt: new Date(Date.now() - 32 * 86400000),
    });
    stubCronAuth(() => null);
  });
  afterEach(() => { vi.restoreAllMocks(); resetServerModuleStubs(); });
  it.each([401, 429, 500, 503, 404])("preserves coverage on transient HTTP %s, while a definitive 404 clears unsupported coverage", async (status) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => String(url).endsWith("/token")
      ? Response.json({ access_token: "token" })
      : Response.json({ error: "lookup failed" }, { status }));
    expect((await GET(new Request("https://example.com/api/subscriptions"))).status).toBe(500);
    const db = await getTestDatabase();
    expect(await db.query.userData.findFirst()).toMatchObject({ federalStatus: status === 404 ? "NONE" : "GOLD" });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ status: "ACTIVE", federalStatus: "GOLD" });
  });
});
