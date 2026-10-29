import { releaseDeclinedStoreCapture } from "@/queries/paypal";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { actionLog, item, paypalTransaction, recruitmentRewards, userData, userItem, webStoreBundle, webStoreOrder, storeUserIdAlias } from "@/drizzle/schema";
import { staffRouter, deleteUser } from "@/server/api/routers/staff";
import { paypalRouter, syncTransactions } from "@/server/api/routers/paypal";
import { itemRouter } from "@/server/api/routers/item";
import { authorizeStoreCapture, deliverStoreOrder, reserveStoreOrder } from "@/server/utils/webStore";
import * as sentry from "@/server/utils/sentry";
import { buyRepsSchema, storeBundleSchema, storeBundleSchemaForItems } from "@/validators/points";
import { dynamicMonthlyRepCap, getStoreBundleMinimumPriceCents, reps2dollars } from "@/utils/paypal";
import { insertItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerFor, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";

const contents = {reputationPoints:20, money:500, items:[{id:"store-item",quantity:7}]};
const offer = {name:"Seichi supplies", priceCents:1250, contents, purchaseLimit:0};
const capture = (id:string) => ({snapshotId:id, captureId:`capture-${id}`, orderId:`provider-${id}`, invoiceId:id, currency:"USD", value:"12.50", raw:{status:"COMPLETED"}});
const reportingTransaction = (id: string): Parameters<typeof syncTransactions>[1][number] => ({
  transaction_info: {
    transaction_id: capture(id).captureId,
    transaction_initiation_date: new Date().toISOString(),
    transaction_updated_date: new Date().toISOString(),
    paypal_reference_id: capture(id).orderId,
    paypal_reference_id_type: "ODR",
    transaction_event_code: "T0006",
    transaction_subject: offer.name,
    transaction_amount: { currency_code: "USD", value: "12.50" },
    transaction_status: "S",
    custom_field: `store:${id}`,
    invoice_id: id,
  },
  cart_info: { item_details: [] },
});

/** Reserve the shared offer for the default buyer and recipient. */
async function reserve() {
  const result = await reserveStoreOrder(await getTestDatabase(), "buyer", "recipient", offer);
  if (!result.success) throw new Error(result.message);
  return result.order;
}

describe("web store validation", () => {
  it("prices included reputation and item quantities at the direct-purchase rate", () => {
    const items = [{id:"store-item",repsCost:10}];
    const minimum = Math.round(reps2dollars(90) * 100);
    expect(getStoreBundleMinimumPriceCents(contents,items)).toBe(minimum);
    const schema = storeBundleSchemaForItems(items);
    const input = {...offer,description:"",isActive:false,priceCents:minimum};
    expect(schema.safeParse(input).success).toBe(true);
    const rejected = schema.safeParse({...input,priceCents:minimum-1});
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.error.issues[0]?.path).toEqual(["priceCents"]);
    expect(getStoreBundleMinimumPriceCents({...contents,reputationPoints:0},[{id:"store-item",repsCost:0}])).toBe(100);
    expect(getStoreBundleMinimumPriceCents(contents,[{id:"store-item",repsCost:-1}])).toBe(Math.round(reps2dollars(20)*100));
  });
  it("requires whole custom quantities within checkout bounds", () => {
    for (const value of [NaN, Infinity, 4, 5.5, 1001]) expect(buyRepsSchema.safeParse({reputationPoints:value}).success).toBe(false);
    expect(buyRepsSchema.parse({reputationPoints:73}).reputationPoints).toBe(73);
  });
  it("rejects empty bundles, fractional prices and duplicate items", () => {
    const input = {...offer, description:"Supplies", isActive:false};
    expect(storeBundleSchema.safeParse(input).success).toBe(true);
    expect(storeBundleSchema.safeParse({...input, priceCents:1250.5}).success).toBe(false);
    expect(storeBundleSchema.safeParse({...input, contents:{reputationPoints:0,money:0,items:[]}}).success).toBe(false);
    expect(storeBundleSchema.safeParse({...input, contents:{...contents,items:[...contents.items,...contents.items]}}).success).toBe(false);
  });
  it("accepts unlimited or whole account limits and rejects invalid limits", () => {
    const input = {...offer, description:"", isActive:true};
    for (const purchaseLimit of [0, 1, 3]) expect(storeBundleSchema.safeParse({...input, purchaseLimit}).success).toBe(true);
    for (const purchaseLimit of [-1, 0.5, Infinity, 1000001]) expect(storeBundleSchema.safeParse({...input, purchaseLimit}).success).toBe(false);
  });
});

describeWithDatabase("web store payments", () => {
  beforeEach(async () => {
    await resetTables(webStoreOrder, webStoreBundle, paypalTransaction, recruitmentRewards, userItem, item, userData, actionLog, storeUserIdAlias);
    await insertUsers([{userId:"buyer",username:"Buyer",role:"OWNER", reputationPoints:0, money:0}, {userId:"recipient",username:"Recipient",reputationPoints:0,reputationPointsTotal:0,money:0}]);
    await insertItems([{id:"store-item",name:"Supplies",canStack:true,stackSize:3}]);
  });
  it("reserves one lifetime purchase atomically across concurrent gift recipients, including zero-reputation offers", async () => {
    const db = await getTestDatabase();
    const limited = {...offer, contents:{...contents,reputationPoints:0}, bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...limited,description:"",isActive:true,purchaseLimit:1});
    const attempts = await Promise.all(Array.from({length:6},(_,index) => reserveStoreOrder(db,"buyer",index % 2 ? "buyer" : "recipient",limited)));
    expect(attempts.filter(result => result.success)).toHaveLength(1);
    expect(attempts.filter(result => !result.success).every(result => result.message.includes("purchase limit"))).toBe(true);
    const order = (await db.query.webStoreOrder.findFirst())!;
    expect(order.bundleId).toBe(limited.bundleId);
    expect(await authorizeStoreCapture(db,order.id,"buyer")).toBeNull();
    await deliverStoreOrder(db,capture(order.id));
    await db.update(webStoreOrder).set({expiresAt:new Date(0)}).where(eq(webStoreOrder.id,order.id));
    expect((await reserveStoreOrder(db,"buyer","recipient",limited)).success).toBe(false);
    const catalog = await (await callerFor(paypalRouter,"buyer")).getStoreBundles();
    expect(catalog.bundles[0]).toMatchObject({purchaseLimit:1,purchaseCount:1});
    const recipientCatalog = await (await callerFor(paypalRouter,"recipient")).getStoreBundles();
    expect(recipientCatalog.bundles[0]?.purchaseCount).toBe(0);
    expect((await reserveStoreOrder(db,"recipient","recipient",limited)).success).toBe(true);
    // Provider recovery always honors a paid snapshot, even after staff hide or edit the offer.
    await db.update(webStoreBundle).set({isActive:false,purchaseLimit:0}).where(eq(webStoreBundle.id,limited.bundleId));
    expect((await deliverStoreOrder(db,capture(order.id))).message).toBe("Purchase already delivered");
  });
  it("counts earlier purchases after staff enable a limit and keeps counts through bundle edits", async () => {
    const db = await getTestDatabase();
    const limited = {...offer,bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...offer,description:"",isActive:true});
    for (let index=0;index<2;index++) {
      const result = await reserveStoreOrder(db,"buyer","recipient",limited);
      if (!result.success) throw new Error(result.message);
      await deliverStoreOrder(db,capture(result.order.id));
    }
    const owner = await callerFor(paypalRouter,"buyer");
    expect((await owner.saveStoreBundle({id:limited.bundleId,data:{...offer,description:"Edited",name:"Renamed",purchaseLimit:2,isActive:true}})).success).toBe(true);
    expect((await owner.getStoreBundles()).bundles[0]).toMatchObject({name:"Renamed",purchaseCount:2,purchaseLimit:2});
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async () => {throw new Error("Must not open PayPal");});
    try {
      const result = await owner.createStoreOrder({recipientId:"buyer",selection:{type:"bundle",bundleId:limited.bundleId}});
      expect(result).toMatchObject({success:false});
      expect(result.message).toContain("purchase limit");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {fetchMock.mockRestore();}
    expect((await reserve()).bundleId).toBeUndefined();
  });
  it("releases expired bundle slots and rechecks them before capturing stale checkouts", async () => {
    const db = await getTestDatabase();
    const limited = {...offer,bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...offer,description:"",isActive:true,purchaseLimit:1});
    const first = await reserveStoreOrder(db,"buyer","recipient",limited);
    if (!first.success) throw new Error(first.message);
    await db.update(webStoreOrder).set({expiresAt:new Date(0)}).where(eq(webStoreOrder.id,first.order.id));
    const second = await reserveStoreOrder(db,"buyer","recipient",limited);
    if (!second.success) throw new Error(second.message);
    expect(await authorizeStoreCapture(db,first.order.id,"buyer")).toContain("purchase limit");
    expect(await authorizeStoreCapture(db,second.order.id,"buyer")).toBeNull();
    await db.update(webStoreOrder).set({expiresAt:new Date(0)});
    expect((await reserveStoreOrder(db,"buyer","recipient",limited)).success).toBe(false);
    const captures = await Promise.all([first,second].map(result => authorizeStoreCapture(db,result.order.id,"buyer")));
    expect(captures.filter(result => result === null)).toHaveLength(1);
    expect(captures.filter(result => result?.includes("purchase limit"))).toHaveLength(1);
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
  });
  it.each([
    "INSTRUMENT_DECLINED", "PAYER_CANNOT_PAY", "TRANSACTION_REFUSED",
    "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED", "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING",
    "CARD_EXPIRED", "CARD_CLOSED", "COMPLIANCE_VIOLATION", "DOMESTIC_TRANSACTION_REQUIRED",
    "PAYEE_BLOCKED_TRANSACTION", "PAYER_ACCOUNT_LOCKED_OR_CLOSED", "PAYER_ACCOUNT_RESTRICTED",
    "TRANSACTION_LIMIT_EXCEEDED", "TRANSACTION_RECEIVING_LIMIT_EXCEEDED", "TRANSACTION_BLOCKED_BY_PAYEE",
    "PAYMENT_DENIED", "CONTINGENCY_NOT_SUCCESSFUL", "REFERENCED_CARD_EXPIRED",
    "CARD_BRAND_NOT_SUPPORTED", "CARD_COUNTRY_NOT_SUPPORTED", "CARD_DATA_NOT_FOUND", "PREFERRED_BRAND_NOT_SUPPORTED",
  ])("releases definitive funding failure %s while preserving pending and newer capture attempts", async issue => {
    const db = await getTestDatabase();
    const limited = {...offer,bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...offer,description:"",isActive:true,purchaseLimit:1});
    const reserved = await reserveStoreOrder(db,"buyer","recipient",limited);
    if (!reserved.success) throw new Error(reserved.message);
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer","old-attempt")).toBeNull();
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer","new-attempt")).toBeNull();
    await releaseDeclinedStoreCapture(db,reserved.order.id,"buyer","old-attempt");
    expect((await db.query.webStoreOrder.findFirst())?.captureAttemptId).toBe("new-attempt");
    const owner = await callerFor(paypalRouter,"buyer");
    let declined = false;
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async url => {
      const path = String(url);
      if (path.endsWith("/v1/oauth2/token")) return Response.json({access_token:"test-only"});
      if (path.endsWith("/v2/checkout/orders")) return Response.json({id:"NEXTORDER123456789"});
      if (path.endsWith("/capture")) return declined
        ? Response.json({details:[{issue}]},{status:422})
        : Response.json({status:"COMPLETED",purchase_units:[{payments:{captures:[{status:"PENDING"}]}}]});
      return Response.json({status:"APPROVED",purchase_units:[{custom_id:`store:${reserved.order.id}`,invoice_id:reserved.order.id,amount:{currency_code:"USD",value:"12.50"}}]});
    });
    try {
      expect((await owner.captureStoreOrder({orderId:"TESTORDER123456789"})).message).toContain("awaiting confirmation");
      await db.update(webStoreOrder).set({expiresAt:new Date(0)});
      expect((await reserveStoreOrder(db,"buyer","recipient",limited)).success).toBe(false);
      declined = true;
      const result = await owner.captureStoreOrder({orderId:"TESTORDER123456789"});
      expect(result).toMatchObject({success:false});
      expect(result.message).toContain("declined");
      expect(await db.query.webStoreOrder.findFirst()).toMatchObject({captureAttemptId:null,expiresAt:new Date(0),grantedAt:null});
      expect((await owner.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:limited.bundleId}})).success).toBe(true);
    } finally {fetchMock.mockRestore();}
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:0,money:0});
  });
  it.each([
    {status:422,details:[{issue:"ORDER_ALREADY_CAPTURED"}]},
    {status:422,details:[{issue:"UNKNOWN_FAILURE"}]},
    {status:422,details:[{issue:"CARD_EXPIRED"},{issue:"ORDER_ALREADY_CAPTURED"}]},
    {status:422,details:[]},
    {status:500,details:[{issue:"CARD_EXPIRED"}]},
  ])("keeps the purchase slot after an ambiguous capture error (%j)", async failure => {
    const db = await getTestDatabase();
    const limited = {...offer,bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...offer,description:"",isActive:true,purchaseLimit:1});
    const reserved = await reserveStoreOrder(db,"buyer","recipient",limited);
    if (!reserved.success) throw new Error(reserved.message);
    const owner = await callerFor(paypalRouter,"buyer");
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async url => {
      const path = String(url);
      if (path.endsWith("/v1/oauth2/token")) return Response.json({access_token:"test-only"});
      if (path.endsWith("/capture")) return Response.json({details:failure.details},{status:failure.status});
      return Response.json({status:"APPROVED",purchase_units:[{custom_id:`store:${reserved.order.id}`,invoice_id:reserved.order.id,amount:{currency_code:"USD",value:"12.50"}}]});
    });
    try {
      await expect(owner.captureStoreOrder({orderId:"TESTORDER123456789"})).rejects.toThrow("PayPal could not complete checkout");
      expect((await db.query.webStoreOrder.findFirst())?.captureAttemptId).not.toBeNull();
      await db.update(webStoreOrder).set({expiresAt:new Date(0)});
      expect((await owner.resolveOrder({orderId:"TESTORDER123456789"})).message).toContain("not completed");
      expect((await owner.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:limited.bundleId}})).message).toContain("purchase limit");
    } finally {fetchMock.mockRestore();}
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
  });
  it("rechecks current limits before capture but still delivers a completed provider payment", async () => {
    const db = await getTestDatabase();
    const limited = {...offer,bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...offer,description:"",isActive:true});
    const first = await reserveStoreOrder(db,"buyer","recipient",limited);
    const second = await reserveStoreOrder(db,"buyer","recipient",limited);
    if (!first.success || !second.success) throw new Error("Reservations failed");
    await deliverStoreOrder(db,capture(first.order.id));
    await db.update(webStoreBundle).set({purchaseLimit:1}).where(eq(webStoreBundle.id,limited.bundleId));
    expect(await authorizeStoreCapture(db,second.order.id,"buyer")).toContain("purchase limit");
    expect((await deliverStoreOrder(db,capture(second.order.id))).success).toBe(true);
    expect((await deliverStoreOrder(db,capture(second.order.id))).message).toBe("Purchase already delivered");
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(2);
  });
  it("releases a previously pending capture after PayPal reports a terminal failure", async () => {
    const db = await getTestDatabase();
    const limited = {...offer,bundleId:"limited"};
    await db.insert(webStoreBundle).values({id:limited.bundleId,...offer,description:"",isActive:true,purchaseLimit:1});
    const reserved = await reserveStoreOrder(db,"buyer","recipient",limited);
    if (!reserved.success) throw new Error(reserved.message);
    const owner = await callerFor(paypalRouter,"buyer");
    let status = "DECLINED";
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async url => String(url).endsWith("/v1/oauth2/token")
      ? Response.json({access_token:"test-only"})
      : Response.json({status:"COMPLETED",purchase_units:[{custom_id:`store:${reserved.order.id}`,invoice_id:reserved.order.id,amount:{currency_code:"USD",value:"12.50"},payments:{captures:[{status}]}}]}));
    try {
      for (const endpoint of ["captureStoreOrder","resolveOrder"] as const) {
        for (status of ["DECLINED","DENIED","FAILED"]) {
          expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toBeNull();
          const result = await owner[endpoint]({orderId:"TESTORDER123456789"});
          expect(result.success).toBe(false);
          expect(result.message).toContain("declined");
          expect((await db.query.webStoreOrder.findFirst())?.captureAttemptId).toBeNull();
        }
      }
      expect((await reserveStoreOrder(db,"buyer","recipient",limited)).success).toBe(true);
    } finally {fetchMock.mockRestore();}
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
  });
  it("delivers the saved snapshot once under concurrent capture retries", async () => {
    const order = await reserve();
    const db = await getTestDatabase();
    await db.insert(webStoreBundle).values({id:"edited", ...offer, description:"changed", isActive:true, contents:{...contents,reputationPoints:999}});
    const results = await Promise.all(Array.from({length:5},() => deliverStoreOrder(db,capture(order.id))));
    expect(results.every(result => result.success)).toBe(true);
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:20,reputationPointsTotal:20,money:500});
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
    const items = await db.query.userItem.findMany();
    expect(items.map(item => item.quantity).sort()).toEqual([1,3,3]);
    expect((await db.query.webStoreOrder.findFirst())?.grantedAt).not.toBeNull();
  });
  it("rejects changed amount, currency and invoice without consuming the receipt", async () => {
    const order = await reserve(); const db = await getTestDatabase();
    for (const patch of [{value:"0.01"},{currency:"EUR"},{invoiceId:"another"},{value:"12.50junk"}]) await expect(deliverStoreOrder(db,{...capture(order.id), ...patch})).rejects.toThrow("does not match");
    expect((await db.query.webStoreOrder.findFirst())?.grantedAt).toBeNull();
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
  });
  it("explains when a transaction lookup has no completed payment without granting rewards", async () => {
    const buyer = await callerFor(paypalRouter, "buyer");
    const db = await getTestDatabase();
    const order = await reserve();
    const pending = reportingTransaction(order.id);
    pending.transaction_info.transaction_status = "P";
    let transactions: Parameters<typeof syncTransactions>[1] = [];
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async url => {
      if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-only" });
      return Response.json({ transaction_details: transactions });
    });
    try {
      for (const report of [[], [pending]]) {
        transactions = report;
        expect(await buyer.resolveTransaction({ transactionId: capture(order.id).captureId, transactionDate: new Date() })).toMatchObject({
          success: false,
          message: "No completed PayPal transaction was found for that ID and date. Check the details and try again.",
        });
      }
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
      expect(await db.query.userItem.findMany()).toHaveLength(0);
      expect(await db.query.webStoreOrder.findFirst()).toMatchObject({ grantedAt: null });
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({ reputationPoints: 0, reputationPointsTotal: 0, money: 0 });
    } finally { fetchMock.mockRestore(); }
  });
  it("reports an unsuccessful transaction lookup when store delivery rolls back and allows recovery", async () => {
    const buyer = await callerFor(paypalRouter, "buyer");
    const db = await getTestDatabase();
    const order = await reserve();
    await db.delete(userData).where(eq(userData.userId, "recipient"));
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async url => {
      if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-only" });
      return Response.json({ transaction_details: [reportingTransaction(order.id)] });
    });
    try {
      const input = { transactionId: capture(order.id).captureId, transactionDate: new Date() };
      expect(await buyer.resolveTransaction(input)).toMatchObject({
        success: false,
        message: `Transaction ID ${capture(order.id).captureId}: Recipient unavailable. Contact support with your payment receipt.`,
      });
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
      expect(await db.query.userItem.findMany()).toHaveLength(0);
      expect(await db.query.webStoreOrder.findFirst()).toMatchObject({ grantedAt: null, captureId: null });
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") })).toMatchObject({ reputationPoints: 0, money: 0 });

      await insertUsers([{ userId: "recipient", username: "Recipient", reputationPoints: 0, reputationPointsTotal: 0, money: 0 }]);
      expect(await buyer.resolveTransaction(input)).toMatchObject({ success: true, message: `${offer.name} delivered` });
      expect(await buyer.resolveTransaction(input)).toMatchObject({ success: true, message: "Purchase already delivered" });
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
      expect(await db.query.userItem.findMany()).toHaveLength(3);
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({ reputationPoints: 20, reputationPointsTotal: 20, money: 500 });
    } finally { fetchMock.mockRestore(); }
  });
  it("skips store refunds while reconciling valid captures and retries", async () => {
    const db = await getTestDatabase();
    const refunded = await reserve();
    await deliverStoreOrder(db, capture(refunded.id));
    const paid = await reserve();
    const pending = await reserve();
    const refund = reportingTransaction(refunded.id);
    Object.assign(refund.transaction_info, {
      transaction_id: "store-refund",
      paypal_reference_id: capture(refunded.id).captureId,
      paypal_reference_id_type: "TXN",
      transaction_event_code: "T1107",
      transaction_amount: { currency_code: "USD", value: "-12.50" },
    });
    const incomplete = reportingTransaction(pending.id);
    incomplete.transaction_info.transaction_status = "P";
    const batch = [refund, reportingTransaction(paid.id), incomplete];
    expect(await syncTransactions(db, batch, "test-only")).toEqual([
      { success: false, message: "Transaction ID store-refund invalid value" },
      expect.objectContaining({ success: true, message: `${offer.name} delivered` }),
    ]);
    expect(await syncTransactions(db, batch, "test-only")).toEqual([
      { success: false, message: "Transaction ID store-refund invalid value" },
      { success: true, message: "Purchase already delivered" },
    ]);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({
      reputationPoints: 40, reputationPointsTotal: 40, money: 1000,
    });
    const receipts = await db.query.paypalTransaction.findMany();
    expect(receipts.map(receipt => receipt.transactionId).sort()).toEqual([
      capture(refunded.id).captureId, capture(paid.id).captureId,
    ].sort());
    expect(await db.query.userItem.findMany()).toHaveLength(6);
    expect(await db.query.recruitmentRewards.findMany()).toHaveLength(0);
    expect(await db.query.webStoreOrder.findFirst({ where: eq(webStoreOrder.id, pending.id) })).toMatchObject({ grantedAt: null });
  });
  it("continues to skip negative legacy payments without granting rewards", async () => {
    const db = await getTestDatabase();
    const refund = reportingTransaction("legacy-refund");
    Object.assign(refund.transaction_info, {
      custom_field: "buyer-recipient",
      transaction_event_code: "T1107",
      transaction_amount: { currency_code: "USD", value: "-12.50" },
    });
    await expect(syncTransactions(db, [refund], "test-only")).resolves.toEqual([
      { success: false, message: "Transaction ID capture-legacy-refund invalid value" },
    ]);
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    expect(await db.query.recruitmentRewards.findMany()).toHaveLength(0);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({
      reputationPoints: 0, reputationPointsTotal: 0, money: 0,
    });
  });
  it("reports failed store deliveries while reconciling valid store and legacy payments once", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "deleted-recipient", username: "DeletedRecipient" }]);
    const failed = await reserveStoreOrder(db, "buyer", "deleted-recipient", offer);
    if (!failed.success) throw new Error(failed.message);
    const paid = await reserve();
    await db.delete(userData).where(eq(userData.userId, "deleted-recipient"));
    const legacy = reportingTransaction("legacy-payment");
    legacy.transaction_info.custom_field = "buyer-buyer";
    const batch = [reportingTransaction(failed.order.id), reportingTransaction(paid.id), legacy];
    const failure = `Transaction ID ${capture(failed.order.id).captureId}: Recipient unavailable. Contact support with your payment receipt.`;
    const caller = await callerFor(paypalRouter, "buyer");
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async url => {
      if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-only" });
      return Response.json({ transaction_details: batch });
    });
    try {
      const result = await caller.resolveTransaction({ transactionId: capture(failed.order.id).captureId, transactionDate: new Date() });
      expect(result).toMatchObject({
        success: false,
        message: `${failure}, ${offer.name} delivered, Transaction ID capture-legacy-payment synced!`,
      });
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") });
      expect(result.userPatch).toMatchObject({ reputationPoints: saved!.reputationPoints, reputationPointsTotal: saved!.reputationPointsTotal });
      expect(result.userDelta).toEqual({});
    } finally { fetchMock.mockRestore(); }
    const buyer = await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") });
    expect(buyer!.reputationPoints).toBeGreaterThan(0);
    expect(await syncTransactions(db, batch, "test-only")).toEqual([
      { success: false, message: failure },
      { success: true, message: "Purchase already delivered" },
      { success: true, message: "Transaction ID capture-legacy-payment already processed" },
    ]);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") })).toMatchObject({
      reputationPoints: buyer!.reputationPoints,
      reputationPointsTotal: buyer!.reputationPointsTotal,
    });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({
      reputationPoints: 20, reputationPointsTotal: 20, money: 500,
    });
    expect((await db.query.paypalTransaction.findMany()).map(receipt => receipt.transactionId).sort()).toEqual([
      capture(paid.id).captureId, "capture-legacy-payment",
    ].sort());
    expect(await db.query.userItem.findMany()).toHaveLength(3);
    expect(await db.query.webStoreOrder.findFirst({ where: eq(webStoreOrder.id, failed.order.id) })).toMatchObject({
      grantedAt: null, captureId: null,
    });
  });
  it.each([
    new DrizzleQueryError("SELECT sql-sentinel FROM WebStoreOrder WHERE id = ?", ["parameter-sentinel"]),
    { message: "non-error-sentinel", details: "parameter-sentinel" },
  ])("sanitizes unexpected delivery failures and continues the batch (%p)", async error => {
    const db = await getTestDatabase();
    const failed = await reserve();
    const paid = await reserve();
    let lookups = 0;
    const failingClient = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "query") return Reflect.get(target, property, receiver);
        const findFirst = (async (...args: Parameters<typeof target.query.webStoreOrder.findFirst>) => {
          if (lookups++ === 0) throw error;
          return target.query.webStoreOrder.findFirst(...args);
        }) as unknown as typeof target.query.webStoreOrder.findFirst;
        return { ...target.query, webStoreOrder: { findFirst } };
      },
    });
    const report = spyOn(sentry, "logError").mockImplementation(() => {});
    try {
      const results = await syncTransactions(failingClient, [reportingTransaction(failed.id), reportingTransaction(paid.id)], "test-only");
      expect(results).toEqual([
        { success: false, message: `Transaction ID ${capture(failed.id).captureId}: Store delivery failed. Retry later or contact support.` },
        expect.objectContaining({ success: true, message: `${offer.name} delivered` }),
      ]);
      expect(results.map(result => result.message).join(" ")).not.toMatch(/sql-sentinel|parameter-sentinel|non-error-sentinel/);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(error, "Store delivery failed", { transactionId: capture(failed.id).captureId });
      expect(await db.query.webStoreOrder.findFirst({ where: eq(webStoreOrder.id, failed.id) })).toMatchObject({ grantedAt: null, captureId: null });
      expect((await db.query.paypalTransaction.findMany()).map(receipt => receipt.transactionId)).toEqual([capture(paid.id).captureId]);
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({ reputationPoints: 20, reputationPointsTotal: 20, money: 500 });
    } finally { report.mockRestore(); }
  });
  it("rolls back the claim when a recipient disappears, allowing retry", async () => {
    const order = await reserve(); const db = await getTestDatabase();
    await db.delete(userData).where(eq(userData.userId,"recipient"));
    await expect(deliverStoreOrder(db,capture(order.id))).rejects.toThrow("Recipient unavailable");
    expect((await db.query.webStoreOrder.findFirst())?.grantedAt).toBeNull();
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    await insertUsers([{userId:"recipient",username:"Recipient",reputationPoints:0,money:0}]);
    expect((await deliverStoreOrder(db,capture(order.id))).success).toBe(true);
  });
  it("rolls back balances and items if the provider receipt conflicts", async () => {
    const first = await reserve(); const second = await reserve(); const db = await getTestDatabase();
    await deliverStoreOrder(db,capture(first.id));
    await expect(deliverStoreOrder(db,{...capture(second.id),orderId:capture(first.id).orderId})).rejects.toThrow();
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:20,money:500});
    expect((await db.query.webStoreOrder.findFirst({where:eq(webStoreOrder.id,second.id)}))?.grantedAt).toBeNull();
    expect(await db.query.userItem.findMany()).toHaveLength(3);
  });
  it("serializes simultaneous reservations against one monthly allowance", async () => {
    const db = await getTestDatabase(); const buyer = await db.query.userData.findFirst({where:eq(userData.userId,"buyer")});
    const cap = dynamicMonthlyRepCap(buyer);
    const large = {...offer,contents:{...contents,reputationPoints:Math.floor(cap*0.6)}};
    const results = await Promise.all(Array.from({length:3},()=>reserveStoreOrder(db,"buyer","recipient",large)));
    expect(results.filter(result => result.success)).toHaveLength(1);
  });
  it("reserves and authorizes zero-reputation offers without transactions or buyer locks", async () => {
    const db = await getTestDatabase();
    const withoutTransactions = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") return () => { throw new Error("Unexpected transaction"); };
        return Reflect.get(target, property, receiver);
      },
    });
    const recorded = await recordQueries(async () => {
      for (const contents of [
        {reputationPoints:0,money:500,items:[]},
        {reputationPoints:0,money:0,items:[{id:"store-item",quantity:1}]},
      ]) {
        const result = await reserveStoreOrder(withoutTransactions,"buyer","recipient",{...offer,contents});
        if (!result.success) throw new Error(result.message);
        expect(await authorizeStoreCapture(withoutTransactions,result.order.id,"buyer")).toBeNull();
      }
    });
    expect(recorded.statements.some(statement => /for update|start transaction|begin/i.test(statement))).toBe(false);
    expect(await db.query.webStoreOrder.findMany()).toHaveLength(2);
  });
  it("keeps allowance checks for zero-reputation offers", async () => {
    const db = await getTestDatabase();
    const zeroOffer = {...offer,contents:{reputationPoints:0,money:500,items:[]}};
    const reserved = await reserveStoreOrder(db,"buyer","recipient",zeroOffer);
    if (!reserved.success) throw new Error(reserved.message);
    const buyer = await db.query.userData.findFirst({where:eq(userData.userId,"buyer")});
    await db.insert(paypalTransaction).values({id:"over-cap",createdById:"buyer",affectedUserId:"recipient",transactionId:"legacy-over-cap",transactionUpdatedDate:new Date().toISOString(),amount:1,reputationPoints:dynamicMonthlyRepCap(buyer)+1,status:"COMPLETED",rawData:{}});
    expect((await reserveStoreOrder(db,"buyer","recipient",zeroOffer)).success).toBe(false);
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("monthly reputation allowance");
  });
  it("keeps buyer, recipient, item and deletion checks for zero-reputation capture", async () => {
    const db = await getTestDatabase();
    const zeroOffer = {...offer,contents:{...contents,reputationPoints:0}};
    const reserved = await reserveStoreOrder(db,"buyer","recipient",zeroOffer);
    if (!reserved.success) throw new Error(reserved.message);
    await db.update(userData).set({isBanned:true}).where(eq(userData.userId,"buyer"));
    expect((await reserveStoreOrder(db,"buyer","recipient",zeroOffer)).success).toBe(false);
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("not available for your account");
    await db.update(userData).set({isBanned:false}).where(eq(userData.userId,"buyer"));
    for (const restriction of [{isAi:true,isBanned:false},{isAi:false,isBanned:true}]) {
      await db.update(userData).set(restriction).where(eq(userData.userId,"recipient"));
      expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("recipient account is no longer available");
    }
    await db.update(userData).set({isAi:false,isBanned:false}).where(eq(userData.userId,"recipient"));
    await db.update(item).set({hidden:true}).where(eq(item.id,"store-item"));
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("item in this checkout is no longer available");
    await db.update(item).set({hidden:false}).where(eq(item.id,"store-item"));
    await db.insert(storeUserIdAlias).values({oldUserId:"recipient",newUserId:"__tnr_deleted_store_user__:recipient"});
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("recipient account is no longer available");
  });
  it("rechecks a live positive-reputation reservation after a legacy payment reconciles", async () => {
    const db = await getTestDatabase();
    const order = await reserve();
    const buyer = await db.query.userData.findFirst({where:eq(userData.userId,"buyer")});
    await db.insert(paypalTransaction).values({id:"paid-cap",createdById:"buyer",affectedUserId:"recipient",transactionId:"legacy-paid-cap",transactionUpdatedDate:new Date().toISOString(),amount:1,reputationPoints:dynamicMonthlyRepCap(buyer),status:"COMPLETED",rawData:{}});
    expect(await authorizeStoreCapture(db,order.id,"buyer")).toContain("monthly reputation allowance");
    expect((await db.query.webStoreOrder.findFirst({where:eq(webStoreOrder.id,order.id)}))?.grantedAt).toBeNull();
  });
  it("serializes concurrent positive-reputation authorization of expired reservations", async () => {
    const db = await getTestDatabase();
    const buyer = await db.query.userData.findFirst({where:eq(userData.userId,"buyer")});
    const large = {...offer,contents:{...contents,reputationPoints:Math.floor(dynamicMonthlyRepCap(buyer)*0.6)}};
    large.priceCents = getStoreBundleMinimumPriceCents(large.contents,[]);
    for (const id of ["expired-first","expired-second","expired-third"]) {
      await db.insert(webStoreOrder).values({id,buyerId:"buyer",recipientId:"recipient",...large,expiresAt:new Date(0)});
    }
    const results = await Promise.all(["expired-first","expired-second","expired-third"].map(id => authorizeStoreCapture(db,id,"buyer")));
    expect(results.filter(result => result === null)).toHaveLength(1);
    expect(results.filter(result => result?.includes("monthly reputation allowance"))).toHaveLength(2);
  });
  it("rejects a zero-reputation capture racing recipient repair and authorizes the repaired identity on retry", async () => {
    const db = await getTestDatabase();
    const reserved = await reserveStoreOrder(db,"buyer","recipient",{...offer,contents:{reputationPoints:0,money:500,items:[]}});
    if (!reserved.success) throw new Error(reserved.message);
    await db.update(userData).set({username:"Terriator"}).where(eq(userData.userId,"buyer"));
    const staff = await callerFor(staffRouter,"buyer");
    const repairing = beforeStatements(db,webStoreOrder,[async () => {
      expect((await staff.updateUserId({userId:"recipient",newUserId:"recipient-repaired"})).success).toBe(true);
    }]);
    expect(await authorizeStoreCapture(repairing,reserved.order.id,"buyer")).toContain("checkout account changed");
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toBeNull();
    expect((await deliverStoreOrder(db,capture(reserved.order.id))).success).toBe(true);
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient-repaired")})).toMatchObject({reputationPoints:0,money:500});
  });
  it("rejects a zero-reputation capture racing buyer repair until the repaired buyer retries", async () => {
    const db = await getTestDatabase();
    const reserved = await reserveStoreOrder(db,"buyer","recipient",{...offer,contents:{reputationPoints:0,money:500,items:[]}});
    if (!reserved.success) throw new Error(reserved.message);
    await db.update(userData).set({role:"USER"}).where(eq(userData.userId,"buyer"));
    await insertUsers([{userId:"operator",username:"Terriator",role:"OWNER"}]);
    const staff = await callerFor(staffRouter,"operator");
    const repairing = beforeStatements(db,webStoreOrder,[async () => {
      expect((await staff.updateUserId({userId:"buyer",newUserId:"buyer-repaired"})).success).toBe(true);
    }]);
    expect(await authorizeStoreCapture(repairing,reserved.order.id,"buyer")).toContain("checkout account changed");
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("not available for your account");
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer-repaired")).toBeNull();
    expect((await deliverStoreOrder(db,capture(reserved.order.id))).success).toBe(true);
    expect(await db.query.paypalTransaction.findFirst()).toMatchObject({createdById:"buyer-repaired",affectedUserId:"recipient",reputationPoints:0});
  });
  it("rejects a zero-reputation capture racing deletion and a recreated recipient", async () => {
    const db = await getTestDatabase();
    const reserved = await reserveStoreOrder(db,"buyer","recipient",{...offer,contents:{reputationPoints:0,money:500,items:[]}});
    if (!reserved.success) throw new Error(reserved.message);
    const deleting = beforeStatements(db,webStoreOrder,[async () => {
      await deleteUser(db,"recipient");
      await insertUsers([{userId:"recipient",username:"Recreated",reputationPoints:0,money:0}]);
    }]);
    expect(await authorizeStoreCapture(deleting,reserved.order.id,"buyer")).toContain("checkout account changed");
    expect(await authorizeStoreCapture(db,reserved.order.id,"buyer")).toContain("recipient account was deleted");
    await expect(deliverStoreOrder(db,capture(reserved.order.id))).rejects.toThrow("Recipient unavailable");
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:0,money:0});
  });
  it("accepts an expired reservation's verified payment and respects paid history", async () => {
    const db = await getTestDatabase(); const order = await reserve();
    await db.update(webStoreOrder).set({expiresAt:new Date(0)}).where(eq(webStoreOrder.id,order.id));
    expect((await deliverStoreOrder(db,capture(order.id))).success).toBe(true);
    const buyer = await db.query.userData.findFirst({where:eq(userData.userId,"buyer")});
    expect((await reserveStoreOrder(db,"buyer","recipient",{...offer,contents:{...contents,reputationPoints:dynamicMonthlyRepCap(buyer)}})).success).toBe(false);
  });
  it("rechecks expired allowance before capture without taking payment", async () => {
    const db = await getTestDatabase(); const old = await reserve();
    await db.update(webStoreOrder).set({expiresAt:new Date(0)}).where(eq(webStoreOrder.id,old.id));
    const buyer = await db.query.userData.findFirst({where:eq(userData.userId,"buyer")});
    await reserveStoreOrder(db,"buyer","recipient",{...offer,contents:{...contents,reputationPoints:dynamicMonthlyRepCap(buyer)}});
    expect(await authorizeStoreCapture(db,old.id,"buyer")).toContain("No payment was captured");
    expect((await db.query.webStoreOrder.findFirst({where:eq(webStoreOrder.id,old.id)}))?.grantedAt).toBeNull();
  });
  it.each(["buyer", "recipient"])("creates server-priced provider orders and reconciles exactly once for %s", async recipientId => {
    const owner = await callerFor(paypalRouter,"buyer"); const db = await getTestDatabase();
    let provider:any; let captures=0; let requestedRepresentation=false;
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async (url,options) => {
      const path=String(url);
      if (path.endsWith("/v1/oauth2/token")) return Response.json({access_token:"test-only"});
      if (path.endsWith("/v2/checkout/orders")) {provider={...JSON.parse(String(options?.body)),id:"TESTORDER123456789",status:"APPROVED"}; return Response.json(provider);}
      if (path.endsWith("/capture")) {captures++;requestedRepresentation=new Headers(options?.headers).get("Prefer")==="return=representation";provider.status="COMPLETED";provider.purchase_units[0].payments={captures:[{id:"CAPTURE1",status:"COMPLETED",amount:provider.purchase_units[0].amount}]};return Response.json({id:provider.id,status:provider.status});}
      return Response.json(provider);
    });
    try {
      const result=await owner.createStoreOrder({recipientId,selection:{type:"custom",reputationPoints:73}});
      expect(result.success).toBe(true); expect(provider.purchase_units[0].amount).toEqual({currency_code:"USD",value:"26.80"});
      const firstCapture=await owner.captureStoreOrder({orderId:provider.id});
      expect(firstCapture.success).toBe(true);expect(firstCapture.userPatch).toMatchObject({ reputationPoints: recipientId === "buyer" ? 73 : 0 });expect(firstCapture.purchase).toMatchObject({value:26.8,transactionId:"CAPTURE1",currency:"USD"});
      const repeatCapture=await owner.captureStoreOrder({orderId:provider.id});
      expect(repeatCapture.success).toBe(true);expect(repeatCapture.userPatch).toEqual(firstCapture.userPatch);expect(repeatCapture.userDelta).toEqual({});expect(repeatCapture.purchase).toBeUndefined();expect(requestedRepresentation).toBe(true);
      expect(captures).toBe(1);
      expect(await db.query.userData.findFirst({where:eq(userData.userId,recipientId)})).toMatchObject({reputationPoints:73});
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
    } finally {fetchMock.mockRestore();}
  });
  it("refuses a mismatched order before calling the provider capture API", async () => {
    const owner = await callerFor(paypalRouter,"buyer"); const order=await reserve(); let captures=0;
    const fetchMock=spyOn(globalThis,"fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/oauth2/token")) return Response.json({access_token:"test-only"});
      if (String(url).endsWith("/capture")) captures++;
      return Response.json({id:"TESTORDER123456789",status:"APPROVED",purchase_units:[{custom_id:`store:${order.id}`,invoice_id:order.id,amount:{currency_code:"USD",value:"0.01"}}]});
    });
    try {expect((await owner.captureStoreOrder({orderId:"TESTORDER123456789"})).success).toBe(false);expect(captures).toBe(0);} finally {fetchMock.mockRestore();}
  });
  it.each(["CREATED", "VOIDED", "PAYER_ACTION_REQUIRED", undefined, "UNKNOWN"])("does not refresh expired allowance or capture an unapproved order (%s)", async status => {
    const owner = await callerFor(paypalRouter, "buyer");
    const db = await getTestDatabase();
    const order = await reserve();
    const expiresAt = new Date(0);
    await db.update(webStoreOrder).set({ expiresAt }).where(eq(webStoreOrder.id, order.id));
    let captures = 0;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async url => {
      if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-only" });
      if (String(url).endsWith("/capture")) captures++;
      return Response.json({
        id: "TESTORDER123456789", status,
        purchase_units: [{ custom_id: `store:${order.id}`, invoice_id: order.id, amount: { currency_code: "USD", value: "12.50" } }],
      });
    });
    try {
      const result = await owner.captureStoreOrder({ orderId: "TESTORDER123456789" });
      expect(result.success).toBe(false);
      expect(captures).toBe(0);
      expect(await db.query.webStoreOrder.findFirst({ where: eq(webStoreOrder.id, order.id) })).toMatchObject({
        expiresAt, grantedAt: null, captureId: null,
      });
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
      expect(result.message).toContain("Approve this checkout");
    } finally { fetchMock.mockRestore(); }
  });
  it("delivers a completed payment after its reservation expires without recapturing", async () => {
    const owner = await callerFor(paypalRouter, "buyer");
    const db = await getTestDatabase();
    const order = await reserve();
    const expiresAt = new Date(0);
    await db.update(webStoreOrder).set({ expiresAt }).where(eq(webStoreOrder.id, order.id));
    let captures = 0;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async url => {
      if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test-only" });
      if (String(url).endsWith("/capture")) captures++;
      return Response.json({
        id: "TESTORDER123456789", status: "COMPLETED",
        purchase_units: [{
          custom_id: `store:${order.id}`, invoice_id: order.id, amount: { currency_code: "USD", value: "12.50" },
          payments: { captures: [{ id: "EXPIREDPAIDCAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: "12.50" } }] },
        }],
      });
    });
    try {
      expect((await owner.captureStoreOrder({ orderId: "TESTORDER123456789" })).success).toBe(true);
      expect((await owner.captureStoreOrder({ orderId: "TESTORDER123456789" })).success).toBe(true);
      expect(captures).toBe(0);
      expect((await db.query.webStoreOrder.findFirst({ where: eq(webStoreOrder.id, order.id) }))?.expiresAt).toEqual(expiresAt);
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") })).toMatchObject({
        reputationPoints: 20, reputationPointsTotal: 20, money: 500,
      });
      expect(await db.query.userItem.findMany()).toHaveLength(3);
    } finally { fetchMock.mockRestore(); }
  });
  it("refuses to capture after the recipient or bundle items disappear", async () => {
    const owner=await callerFor(paypalRouter,"buyer");const db=await getTestDatabase();const order=await reserve();let captures=0;
    const fetchMock=spyOn(globalThis,"fetch").mockImplementation(async url=>{
      if(String(url).endsWith("/v1/oauth2/token"))return Response.json({access_token:"test-only"});
      if(String(url).endsWith("/capture"))captures++;
      return Response.json({id:"TESTORDER123456789",status:"APPROVED",purchase_units:[{custom_id:`store:${order.id}`,invoice_id:order.id,amount:{currency_code:"USD",value:"12.50"}}]});
    });
    try {
      await db.delete(item).where(eq(item.id,"store-item"));
      expect((await owner.captureStoreOrder({orderId:"TESTORDER123456789"})).success).toBe(false);
      await insertItems([{id:"store-item",name:"Supplies"}]);await db.delete(userData).where(eq(userData.userId,"recipient"));
      expect((await owner.captureStoreOrder({orderId:"TESTORDER123456789"})).success).toBe(false);
      expect(captures).toBe(0);
    }finally{fetchMock.mockRestore();}
  });
  it("keeps hidden bundle management unavailable to players", async () => {
    const player = await callerFor(paypalRouter,"recipient");
    expect((await player.saveStoreBundle({data:{...offer,description:"",isActive:false}})).success).toBe(false);
    await expect(player.getStoreBundles({includeInactive:true})).rejects.toThrow();
    const owner = await callerFor(paypalRouter,"buyer");
    expect((await owner.saveStoreBundle({data:{...offer,description:"",isActive:false}})).success).toBe(true);
    expect((await player.getStoreBundles()).bundles).toHaveLength(0);
    const catalog = await owner.getStoreBundles({includeInactive:true});
    expect(catalog.bundles).toHaveLength(1);
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async () => Response.json({access_token:"test-only",id:"TESTORDER123456789"}));
    try {
      expect((await player.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:catalog.bundles[0]!.id}})).success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {fetchMock.mockRestore();}
    expect(await dbAuditCount()).toBe(1);
  });
  it("lets content administrators manage bundles while enforcing price floors and bans", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({role:"CONTENT-ADMIN"}).where(eq(userData.userId,"buyer"));
    const manager = await callerFor(paypalRouter,"buyer");
    const data = {...offer,description:"",isActive:false};
    expect((await manager.saveStoreBundle({data})).success).toBe(true);
    const draft = (await manager.getStoreBundles({includeInactive:true})).bundles[0]!;
    expect(draft.isActive).toBe(false);
    expect((await manager.saveStoreBundle({id:draft.id,data:{...data,name:"Content bundle",isActive:true}})).success).toBe(true);
    expect((await manager.getStoreBundles()).bundles).toHaveLength(1);
    expect((await manager.saveStoreBundle({id:draft.id,data:{...data,priceCents:100}})).success).toBe(false);
    expect((await db.query.webStoreBundle.findFirst())?.priceCents).toBe(offer.priceCents);
    expect((await manager.saveStoreBundle({id:draft.id,data})).success).toBe(true);
    expect((await manager.getStoreBundles()).bundles).toHaveLength(0);
    expect(await dbAuditCount()).toBe(3);
    await db.update(userData).set({isBanned:true}).where(eq(userData.userId,"buyer"));
    expect((await manager.saveStoreBundle({id:draft.id,data:{...data,isActive:true}})).success).toBe(false);
    expect(await dbAuditCount()).toBe(3);
  });
  it("does not grant bundle management to other content or administrator roles", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(paypalRouter,"recipient");
    for (const role of ["CONTENT","HEAD_CONTENT","CODING-ADMIN","EVENT-ADMIN"] as const) {
      await db.update(userData).set({role}).where(eq(userData.userId,"recipient"));
      expect((await caller.saveStoreBundle({data:{...offer,description:"",isActive:false}})).success).toBe(false);
      await expect(caller.getStoreBundles({includeInactive:true})).rejects.toThrow("Only the owner and content administrators");
    }
    expect(await db.query.webStoreBundle.findMany()).toHaveLength(0);
    expect(await dbAuditCount()).toBe(0);
  });
  it("rejects bundle creation and edits below the fresh reputation/item price floor", async () => {
    const db = await getTestDatabase();
    const owner = await callerFor(paypalRouter,"buyer");
    await db.update(item).set({repsCost:10}).where(eq(item.id,"store-item"));
    const data = {...offer,description:"",isActive:true};
    expect((await owner.saveStoreBundle({data})).success).toBe(false);
    expect(await db.query.webStoreBundle.findMany()).toHaveLength(0);
    expect(await dbAuditCount()).toBe(0);
    data.priceCents = Math.round(reps2dollars(90)*100);
    expect((await owner.saveStoreBundle({data})).success).toBe(true);
    const saved = (await db.query.webStoreBundle.findFirst())!;
    expect((await owner.saveStoreBundle({id:saved.id,data:{...data,priceCents:data.priceCents-1}})).success).toBe(false);
    await db.update(item).set({repsCost:20}).where(eq(item.id,"store-item"));
    expect((await owner.saveStoreBundle({id:saved.id,data})).success).toBe(false);
    expect((await db.query.webStoreBundle.findFirst())?.priceCents).toBe(data.priceCents);
    expect(await dbAuditCount()).toBe(1);
  });
  it("blocks underpriced published offers before creating a provider order", async () => {
    const db = await getTestDatabase();
    const owner = await callerFor(paypalRouter,"buyer");
    await db.insert(webStoreBundle).values({id:"underpriced",...offer,description:"",isActive:true,priceCents:100});
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async () => Response.json({}));
    try {
      expect((await owner.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:"underpriced"}})).success).toBe(false);
      await db.update(webStoreBundle).set({priceCents:offer.priceCents}).where(eq(webStoreBundle.id,"underpriced"));
      await db.update(item).set({repsCost:10}).where(eq(item.id,"store-item"));
      expect((await owner.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:"underpriced"}})).success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await db.query.webStoreOrder.findMany()).toHaveLength(0);
    } finally {fetchMock.mockRestore();}
  });
  it("rechecks repriced items before capture while honoring completed payment recovery", async () => {
    const db = await getTestDatabase();
    const owner = await callerFor(paypalRouter,"buyer");
    await owner.saveStoreBundle({data:{...offer,description:"",isActive:true}});
    const bundle = (await db.query.webStoreBundle.findFirst())!;
    let provider:any; let captures=0;
    const completePayment = () => {
      provider.status="COMPLETED";
      provider.purchase_units[0].payments={captures:[{id:"REPRICEDCAPTURE",status:"COMPLETED",amount:provider.purchase_units[0].amount}]};
    };
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async (url,options) => {
      const path=String(url);
      if(path.endsWith("/v1/oauth2/token"))return Response.json({access_token:"test-only"});
      if(path.endsWith("/v2/checkout/orders")){provider={...JSON.parse(String(options?.body)),id:"TESTORDER123456789",status:"APPROVED"};return Response.json(provider);}
      if(path.endsWith("/capture")){captures++;completePayment();}
      return Response.json(provider);
    });
    try {
      expect((await owner.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:bundle.id}})).success).toBe(true);
      await db.update(item).set({repsCost:10}).where(eq(item.id,"store-item"));
      const rejected=await owner.captureStoreOrder({orderId:provider.id});
      expect(rejected.success).toBe(false);
      expect(rejected.message).toContain("No payment was captured");
      expect(captures).toBe(0);
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
      completePayment();
      expect((await owner.captureStoreOrder({orderId:provider.id})).success).toBe(true);
      expect((await owner.resolveOrder({orderId:provider.id})).success).toBe(true);
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
      expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:20,money:500});
      expect((await db.query.userItem.findMany()).reduce((sum,row)=>sum+row.quantity,0)).toBe(7);
    } finally {fetchMock.mockRestore();}
  });
  it("rejects published bundles containing hidden items before opening checkout", async () => {
    const owner = await callerFor(paypalRouter,"buyer"); const db = await getTestDatabase();
    await db.update(item).set({hidden:true}).where(eq(item.id,"store-item"));
    expect((await owner.saveStoreBundle({data:{...offer,description:"",isActive:true,contents:{reputationPoints:0,money:0,items:[{id:"store-item",quantity:1}]}}})).success).toBe(true);
    const bundle = (await owner.getStoreBundles()).bundles[0]!;
    const player = await callerFor(paypalRouter,"recipient");
    const input = {recipientId:"recipient",selection:{type:"bundle" as const,bundleId:bundle.id}};
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async () => Response.json({access_token:"test-only",id:"TESTORDER123456789"}));
    try {
      const created = await player.createStoreOrder(input);
      expect({created:created.success,providerCalls:fetchMock.mock.calls.length,orders:(await db.query.webStoreOrder.findMany()).length}).toEqual({created:false,providerCalls:0,orders:0});
      expect(created.message).toBe("This bundle contains an unavailable item. Contact staff.");
    } finally {fetchMock.mockRestore();}
  });
  it("rechecks hidden items before capture while preserving completed payment recovery", async () => {
    const owner = await callerFor(paypalRouter,"buyer"); const db = await getTestDatabase();
    await owner.saveStoreBundle({data:{...offer,description:"",isActive:true,contents:{reputationPoints:0,money:0,items:[{id:"store-item",quantity:1}]}}});
    const bundle = (await owner.getStoreBundles()).bundles[0]!;
    const player = await callerFor(paypalRouter,"recipient");
    const inventory = await callerFor(itemRouter,"recipient");
    let provider:any; let captures=0;
    const completePayment = () => {
      provider.status="COMPLETED";
      provider.purchase_units[0].payments={captures:[{id:"HIDDENITEMCAPTURE",status:"COMPLETED",amount:provider.purchase_units[0].amount}]};
    };
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async (url,options) => {
      const path=String(url);
      if(path.endsWith("/v1/oauth2/token"))return Response.json({access_token:"test-only"});
      if(path.endsWith("/v2/checkout/orders")){provider={...JSON.parse(String(options?.body)),id:"TESTORDER123456789",status:"APPROVED"};return Response.json(provider);}
      if(path.endsWith("/capture")){captures++;completePayment();}
      return Response.json(provider);
    });
    try {
      expect((await player.createStoreOrder({recipientId:"recipient",selection:{type:"bundle",bundleId:bundle.id}})).success).toBe(true);
      await db.update(item).set({hidden:true}).where(eq(item.id,"store-item"));
      const result=await player.captureStoreOrder({orderId:provider.id});
      expect({success:result.success,captures,receipts:(await db.query.paypalTransaction.findMany()).length,inventoryRows:(await db.query.userItem.findMany()).length,visibleItems:(await inventory.getUserItems()).length,visibleVariants:(await inventory.getUserItemsWithVariants()).length}).toEqual({success:false,captures:0,receipts:0,inventoryRows:0,visibleItems:0,visibleVariants:0});
      expect(result.message).toBe("An item in this checkout is no longer available. No payment was captured.");
      expect(provider.status).toBe("APPROVED");
      completePayment();
      expect((await player.captureStoreOrder({orderId:provider.id})).success).toBe(true);
      expect((await player.captureStoreOrder({orderId:provider.id})).success).toBe(true);
      expect(captures).toBe(0);
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
      expect(await db.query.userItem.findMany()).toHaveLength(1);
      await db.update(item).set({hidden:false}).where(eq(item.id,"store-item"));
      expect(await inventory.getUserItems()).toHaveLength(1);
      expect(await inventory.getUserItemsWithVariants()).toHaveLength(1);
    } finally {fetchMock.mockRestore();}
  });
  it("assigns fresh checkout identities to repeated purchases of a published bundle", async () => {
    const owner = await callerFor(paypalRouter,"buyer");
    await owner.saveStoreBundle({data:{...offer,description:"",isActive:true}});
    const bundle = (await owner.getStoreBundles()).bundles[0]!;
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async () => Response.json({access_token:"test-only",id:"TESTORDER123456789"}));
    try {
      const orders = await Promise.all(Array.from({length:2},()=>owner.createStoreOrder({recipientId:"recipient", selection:{type:"bundle",bundleId:bundle.id}})));
      expect(orders.every(order => order.success)).toBe(true);
      const rows = await (await getTestDatabase()).query.webStoreOrder.findMany();
      expect(new Set(rows.map(row => row.id)).size).toBe(2);
      expect(rows.some(row => row.id === bundle.id)).toBe(false);
    } finally {fetchMock.mockRestore();}
  });
  it("rejects AI/banned recipients and unavailable items before payment", async () => {
    const owner = await callerFor(paypalRouter,"buyer"); const db = await getTestDatabase();
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async () => Response.json({access_token:"test-only",id:"TESTORDER123456789"}));
    try {
      for (const restriction of [{isAi:true,isBanned:false},{isAi:false,isBanned:true}]) {
        await db.update(userData).set(restriction).where(eq(userData.userId,"recipient"));
        expect((await owner.createStoreOrder({recipientId:"recipient",selection:{type:"custom",reputationPoints:20}})).success).toBe(false);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {fetchMock.mockRestore();}
    expect((await owner.saveStoreBundle({data:{...offer,description:"",isActive:true,contents:{...contents,items:[{id:"missing",quantity:1}]}}})).success).toBe(false);
    expect(await db.query.webStoreOrder.findMany()).toHaveLength(0);
  });
  it("keeps pending delivery working after staff repair a recipient's account ID", async () => {
    const db=await getTestDatabase(); const order=await reserve();
    await db.update(userData).set({username:"Terriator"}).where(eq(userData.userId,"buyer"));
    const staff=await callerFor(staffRouter,"buyer");
    expect((await staff.updateUserId({userId:"recipient",newUserId:"recipient-repaired"})).success).toBe(true);
    expect((await deliverStoreOrder(db,capture(order.id))).success).toBe(true);
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient-repaired")})).toMatchObject({reputationPoints:20,money:500});
  });
  it("does not deliver an old checkout to a recreated character after deletion", async () => {
    const db=await getTestDatabase(); const order=await reserve();
    await deleteUser(db,"recipient");
    await insertUsers([{userId:"recipient",username:"Recreated",reputationPoints:0,money:0}]);
    await expect(deliverStoreOrder(db,capture(order.id))).rejects.toThrow("Recipient unavailable");
    expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:0,money:0});
  });
  it("prevents paid recovery from restoring inventory during character deletion", async () => {
    const db = await getTestDatabase();
    const order = await reserve();
    const buyer = await callerFor(paypalRouter,"buyer");
    await db.insert(userItem).values({id:"existing-item",userId:"recipient",itemId:"store-item",quantity:1});
    const fetchMock = spyOn(globalThis,"fetch").mockImplementation(async url => {
      if(String(url).endsWith("/v1/oauth2/token"))return Response.json({access_token:"test-only"});
      return Response.json({id:"TESTORDER123456789",status:"COMPLETED",purchase_units:[{custom_id:`store:${order.id}`,invoice_id:order.id,amount:{currency_code:"USD",value:"12.50"},payments:{captures:[{id:"DELETIONCAPTURE",status:"COMPLETED",amount:{currency_code:"USD",value:"12.50"}}]}}]});
    });
    let attemptedRecovery = false;
    // History cleanup follows inventory cleanup, while the recipient row still exists.
    const deleting = beforeStatements(db, actionLog, [async () => {
      attemptedRecovery = true;
      expect((await db.query.storeUserIdAlias.findFirst())?.newUserId).toMatch(/^__tnr_deleted_store_user__:/);
      expect(await db.query.userItem.findMany()).toHaveLength(0);
      expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toBeDefined();
      await expect(buyer.resolveOrder({orderId:"TESTORDER123456789"})).rejects.toThrow("Recipient unavailable");
    }]);
    try {
      await deleteUser(deleting,"recipient");
      expect(attemptedRecovery).toBe(true);
      expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toBeUndefined();
      await insertUsers([{userId:"recipient",username:"Recreated",reputationPoints:0,money:0}]);
      await expect(buyer.resolveOrder({orderId:"TESTORDER123456789"})).rejects.toThrow("Recipient unavailable");
      const inventory = await callerFor(itemRouter,"recipient");
      expect(await inventory.getUserItems()).toHaveLength(0);
      expect(await db.query.userItem.findMany()).toHaveLength(0);
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
      expect((await db.query.webStoreOrder.findFirst())?.grantedAt).toBeNull();
      expect(await db.query.userData.findFirst({where:eq(userData.userId,"recipient")})).toMatchObject({reputationPoints:0,money:0});
    } finally {fetchMock.mockRestore();}
  });
  it("delivers item-only packs and rep-only packs", async () => {
    const db = await getTestDatabase();
    for (const contents of [{reputationPoints:0,money:0,items:[{id:"store-item",quantity:1}]},{reputationPoints:73,money:0,items:[]}]) {
      const result = await reserveStoreOrder(db,"buyer","recipient",{...offer,contents});
      if (!result.success) throw new Error(result.message);
      expect((await deliverStoreOrder(db,capture(result.order.id))).success).toBe(true);
    }
  });
});
const dbAuditCount = async () => (await (await getTestDatabase()).query.actionLog.findMany()).length;
