import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  accountDeletion,
  actionLog,
  adClick,
  bloodline,
  bloodlineRolls,
  metaConsent,
  metaTracking,
  questHistory,
  storeUserIdAlias,
  userAttribute,
  userData,
  userItem,
  village,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import * as metaQueries from "@/queries/metaTracking";
import { selectMetaConversions } from "@/queries/metaTracking";
import { metaRouter } from "@/server/api/routers/meta";
import { registerRouter } from "@/server/api/routers/register";
import { saveMetaTracking, withdrawMetaTracking } from "@/server/utils/metaTracking";
import type { MetaTrackingInput } from "@/validators/metaTracking";
import { deferred } from "../../../setup/deferred";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { characterInput, insertRegistrationContent } from "../../../setup/registration";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const tracking = (): MetaTrackingInput => ({
  revision: CONSENT_REVISION,
  consentId: crypto.randomUUID(),
  decidedAt: new Date(Date.now() - 1000).toISOString(),
  granted: true as const,
  fbc: `fb.1.${Date.now() - 10000}.Clicked_Ad`,
});
const originalConfiguration = {
  META_CAPI_ENABLED: env.META_CAPI_ENABLED,
  META_CAPI_ACCESS_TOKEN: env.META_CAPI_ACCESS_TOKEN,
  NEXT_PUBLIC_META_PIXEL_ID: env.NEXT_PUBLIC_META_PIXEL_ID,
  NODE_ENV: env.NODE_ENV,
};

describeWithDatabase("consented Meta registration and receipt delivery", () => {
  beforeEach(async () => {
    stubRateLimitTransport({ answerOtherRequests: true });
    Object.assign(env, {
      META_CAPI_ENABLED: "true",
      META_CAPI_ACCESS_TOKEN: "test-placeholder",
      NEXT_PUBLIC_META_PIXEL_ID: "12345",
      NODE_ENV: "production",
    });
    await resetTables(
      accountDeletion,
      storeUserIdAlias,
      actionLog,
      adClick,
      bloodline,
      bloodlineRolls,
      metaConsent,
      metaTracking,
      questHistory,
      userAttribute,
      userData,
      userItem,
      village,
    );
    await insertRegistrationContent("meta");
  });
  afterEach(() => {
    Object.assign(env, originalConfiguration);
    vi.restoreAllMocks();
  });

  const register = async (userId: string, snapshot = tracking()) =>
    registerRouter
      .createCaller({
        drizzle: await getTestDatabase(),
        userId,
        userAgent: "Test browser",
      } as never)
      .createCharacter(
        characterInput({
          username: userId,
          bloodlineId: "meta-bloodline",
          marketingConsent: "granted",
          metaTracking: snapshot,
        }),
      );

  it("persists a confirmed conversion independently of the browser callback and returns its exact ID", async () => {
    const db = await getTestDatabase();
    const snapshot = tracking();
    const result = await register("MetaNinja", snapshot);
    expect(result.success).toBe(true);
    const pending = await selectMetaConversions(db, "register", { pendingOnly: true });
    expect(pending).toHaveLength(1);
    const receipt = pending[0];
    if (!receipt) throw new Error("Missing confirmed receipt");
    const receipts = await metaRouter
      .createCaller({
        drizzle: db,
        userId: "MetaNinja",
        userAgent: "Test browser",
      } as never)
      .synchronizeConsent(snapshot);
    expect(receipts).toEqual([{ event: "register", eventId: receipt.eventId }]);
    expect(JSON.stringify(receipts)).not.toContain("MetaNinja");
    expect((await register("MetaNinja", snapshot)).success).toBe(false);
    expect((await selectMetaConversions(db, "register"))[0]?.eventId).toBe(
      pending[0]?.eventId,
    );
  });

  it("honors anonymous withdrawal and cannot be restored by a late registration grant", async () => {
    const db = await getTestDatabase();
    const snapshot = tracking();
    await register("OptoutNinja", snapshot);
    const anonymous = metaRouter.createCaller({
      drizzle: db,
      userId: null,
      userIp: "203.0.113.18",
    } as never);
    await anonymous.synchronizeConsent({
      revision: CONSENT_REVISION,
      consentId: snapshot.consentId,
      decidedAt: new Date().toISOString(),
      granted: false,
    });
    const receipts = await metaRouter
      .createCaller({
        drizzle: db,
        userId: "OptoutNinja",
        userAgent: "Test browser",
      } as never)
      .synchronizeConsent(snapshot);
    expect(receipts).toEqual([]);
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    expect((await db.query.metaTracking.findFirst())?.fbc).toBeNull();
  });

  it("keeps successful character creation successful if optional attribution storage fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(metaQueries, "recordMetaConsent").mockRejectedValue(
      new Error("Temporary storage failure") as never,
    );
    expect((await register("StorageNinja")).success).toBe(true);
  });

  it("rejects a delayed grant from a new browser before account withdrawal and accepts a later decision", async () => {
    const db = await getTestDatabase();
    const snapshot = tracking();
    await register("BarrierNinja", snapshot);
    const withdrawalTime = new Date(Date.now() - 100);
    await withdrawMetaTracking(
      db,
      { consentId: snapshot.consentId, decidedAt: withdrawalTime },
      "BarrierNinja",
    );
    const oldGrant = { ...snapshot, consentId: crypto.randomUUID() };
    expect(await saveMetaTracking(db, "BarrierNinja", oldGrant, "Browser")).toBe(false);
    expect(
      await db.query.metaConsent.findFirst({
        where: eq(metaConsent.id, oldGrant.consentId),
      }),
    ).toBeUndefined();
    expect((await db.query.metaTracking.findFirst())?.fbc).toBeNull();
    const newGrant = {
      ...snapshot,
      consentId: crypto.randomUUID(),
      decidedAt: new Date().toISOString(),
    };
    expect(await saveMetaTracking(db, "BarrierNinja", newGrant, "Browser")).toBe(true);
    expect((await db.query.metaTracking.findFirst())?.fbc).toBe(snapshot.fbc ?? null);
  });

  it("retains the withdrawal barrier after the same browser grants again", async () => {
    const db = await getTestDatabase();
    const snapshot = tracking();
    await register("RegrantNinja", snapshot);
    const withdrawalTime = new Date(Date.now() - 100);
    await withdrawMetaTracking(
      db,
      { consentId: snapshot.consentId, decidedAt: withdrawalTime },
      "RegrantNinja",
    );
    expect(
      await saveMetaTracking(
        db,
        "RegrantNinja",
        { ...snapshot, decidedAt: new Date().toISOString() },
        "Browser",
      ),
    ).toBe(true);
    expect(
      await saveMetaTracking(
        db,
        "RegrantNinja",
        { ...snapshot, consentId: crypto.randomUUID() },
        "Browser",
      ),
    ).toBe(false);
    expect((await db.query.metaConsent.findFirst())?.withdrawnAt).toEqual(
      withdrawalTime,
    );
  });

  it("waits for an in-flight save before retirement cleanup and rejects later saves", async () => {
    const db = await getTestDatabase();
    const snapshot = tracking();
    await register("DeleteNinja", snapshot);
    const entered = deferred();
    const resume = deferred();
    const original = metaQueries.recordMetaConsent;
    vi.spyOn(metaQueries, "recordMetaConsent").mockImplementation((async (
      ...args: Parameters<typeof original>
    ) => {
      entered.resolve();
      await resume.promise;
      return original(...args);
    }) as never);
    const saving = saveMetaTracking(db, "DeleteNinja", snapshot, "Browser");
    await entered.promise;
    await db
      .insert(storeUserIdAlias)
      .values({ oldUserId: "DeleteNinja", newUserId: "deleted:test" });
    const cleanup = (async () => {
      await metaQueries.waitForMetaSavesBeforeDeletion(db, "DeleteNinja");
      await Promise.all([
        db.delete(metaConsent).where(eq(metaConsent.userId, "DeleteNinja")),
        db.delete(metaTracking).where(eq(metaTracking.userId, "DeleteNinja")),
      ]);
      await db.delete(userData).where(eq(userData.userId, "DeleteNinja"));
    })();
    resume.resolve();
    await Promise.all([saving, cleanup]);
    expect(await saveMetaTracking(db, "DeleteNinja", snapshot, "Browser")).toBe(false);
    expect(await db.select().from(metaConsent)).toHaveLength(0);
    expect(await db.select().from(metaTracking)).toHaveLength(0);
  });

  it("keeps account withdrawal after its browser consent moves to another account", async () => {
    const db = await getTestDatabase();
    const snapshot = tracking();
    await register("SwitchNinja", snapshot);
    await insertUsers([{ userId: "another-account", username: "AnotherNinja" }]);
    await withdrawMetaTracking(
      db,
      { consentId: snapshot.consentId, decidedAt: new Date(Date.now() - 100) },
      "SwitchNinja",
    );
    expect(
      await saveMetaTracking(
        db,
        "another-account",
        { ...snapshot, decidedAt: new Date().toISOString() },
        "Browser",
      ),
    ).toBe(true);
    expect(
      await saveMetaTracking(
        db,
        "SwitchNinja",
        { ...snapshot, consentId: crypto.randomUUID() },
        "Browser",
      ),
    ).toBe(false);
  });
});
