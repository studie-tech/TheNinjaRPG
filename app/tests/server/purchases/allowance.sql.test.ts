import { beforeEach, expect, it } from "bun:test";
import {
  paypalTransaction,
  stripeCheckout,
  stripePayment,
  userData,
  webStoreOrder,
} from "@/drizzle/schema";
import { reputationAllowanceUsed } from "@/server/utils/purchases/allowance";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const receipt = (id: string, reputationPoints: number) => ({
  id,
  createdById: "buyer",
  affectedUserId: "buyer",
  transactionId: `transaction-${id}`,
  transactionUpdatedDate: new Date().toISOString(),
  amount: 1,
  reputationPoints,
  status: "COMPLETED",
  type: "REP_PURCHASE" as const,
  rawData: {},
});

describeWithDatabase("reputation allowance", () => {
  beforeEach(async () => {
    await resetTables(
      paypalTransaction,
      stripePayment,
      stripeCheckout,
      webStoreOrder,
      userData,
    );
    await insertUsers([{ userId: "buyer", username: "Buyer" }]);
    const db = await getTestDatabase();
    await db
      .insert(paypalTransaction)
      .values([receipt("kept", 20), receipt("retried", 5)]);
  });

  it("counts every receipt unless the caller names its own", async () => {
    const db = await getTestDatabase();
    expect(await reputationAllowanceUsed(db, "buyer")).toBe(25);
    expect(
      await reputationAllowanceUsed(db, "buyer", { excludePaypalId: "retried" }),
    ).toBe(20);
  });

  it("does not exclude a PayPal receipt by another provider's id", async () => {
    const db = await getTestDatabase();
    const options = { excludeStripeCheckoutId: "retried", excludeStoreOrderId: "kept" };
    expect(await reputationAllowanceUsed(db, "buyer", options)).toBe(25);
  });
});
