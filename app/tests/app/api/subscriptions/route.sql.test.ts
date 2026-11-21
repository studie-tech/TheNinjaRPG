import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/subscriptions/route";
import {
  actionLog,
  bloodline,
  bloodlineRolls,
  paypalSubscription,
  storePurchase,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { restoreEnvAfterEach } from "../../../setup/env";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Transient provider failures must not masquerade as confirmed subscription termination. */
describeWithDatabase("PayPal renewal lookup failures", () => {
  beforeEach(async () => {
    await resetTables(paypalSubscription, storePurchase, stripePayment, userData);
    await insertUsers([
      { userId: "renewal-buyer", username: "RenewalBuyer", federalStatus: "GOLD" },
    ]);
    await (await getTestDatabase()).insert(paypalSubscription).values({
      id: "due-subscription",
      subscriptionId: "I-DUE",
      orderId: "I-DUE",
      createdById: "renewal-buyer",
      affectedUserId: "renewal-buyer",
      federalStatus: "GOLD",
      status: "ACTIVE",
      updatedAt: new Date(Date.now() - 32 * 86400000),
    });
    stubCronAuth(() => null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });
  it.each([401, 429, 500, 503, 404])(
    "preserves coverage on transient HTTP %s, while a definitive 404 clears unsupported coverage",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
        String(url).endsWith("/token")
          ? Response.json({ access_token: "token" })
          : Response.json({ error: "lookup failed" }, { status }),
      );
      expect(
        (await GET(new Request("https://example.com/api/subscriptions"))).status,
      ).toBe(500);
      const db = await getTestDatabase();
      expect(await db.query.userData.findFirst()).toMatchObject({
        federalStatus: status === 404 ? "NONE" : "GOLD",
      });
      expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
        status: "ACTIVE",
        federalStatus: "GOLD",
      });
    },
  );
});

/** A Diamond pick is not owned: when the subscription ends, the earlier bloodline returns. */
describeWithDatabase("Diamond subscription expiry", () => {
  const userId = "diamond_buyer";
  restoreEnvAfterEach("NEXT_PUBLIC_PAYPAL_PLAN_ID_DIAMOND");
  beforeEach(async () => {
    await resetTables(
      actionLog,
      bloodlineRolls,
      bloodline,
      paypalSubscription,
      storePurchase,
      stripePayment,
      userData,
    );
    process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_DIAMOND = "P-DIAMOND";
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId,
        username: "DiamondBuyer",
        status: "AWAKE",
        federalStatus: "DIAMOND",
        bloodlineId: "diamond-pick",
        diamondBloodlineActive: true,
        preDiamondBloodlineId: "owned-line",
      },
    ]);
    await db.insert(bloodline).values(
      ["owned-line", "diamond-pick"].map((id) => ({
        id,
        name: id,
        rank: "B" as const,
        image: "",
        description: "Diamond expiry fixture",
        effects: [],
      })),
    );
    await db
      .insert(bloodlineRolls)
      .values({ id: "owned-roll", userId, bloodlineId: "owned-line", type: "DIRECT" });
    const lastPayment = new Date(Date.now() - 32 * 86400000);
    await db.insert(paypalSubscription).values({
      id: "diamond-subscription",
      subscriptionId: "I-DIAMOND",
      orderId: "I-DIAMOND",
      createdById: userId,
      affectedUserId: userId,
      federalStatus: "DIAMOND",
      status: "ACTIVE",
      updatedAt: lastPayment,
    });
    stubCronAuth(() => null);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).endsWith("/token")
        ? Response.json({ access_token: "token" })
        : Response.json({
            id: "I-DIAMOND",
            status: "CANCELLED",
            plan_id: "P-DIAMOND",
            custom_id: `${userId}-${userId}`,
            billing_info: {
              last_payment: {
                time: lastPayment.toISOString(),
                amount: { value: "25.00", currency_code: "USD" },
              },
            },
          }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it("ends Diamond and restores the pre-Diamond bloodline with an action log", async () => {
    expect(
      (await GET(new Request("https://example.com/api/subscriptions"))).status,
    ).toBe(200);
    const db = await getTestDatabase();
    expect(await db.query.userData.findFirst()).toMatchObject({
      federalStatus: "NONE",
      bloodlineId: "owned-line",
      diamondBloodlineActive: false,
      preDiamondBloodlineId: null,
    });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
      status: "CANCELLED",
    });
    expect(await db.query.actionLog.findMany()).toEqual([
      expect.objectContaining({
        userId,
        relatedMsg: "Diamond Bloodline Reverted",
        relatedId: "owned-line",
      }),
    ]);
    expect(await db.query.bloodlineRolls.findMany()).toHaveLength(1);
  });
});
