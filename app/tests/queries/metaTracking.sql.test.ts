import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { TUTORIAL_GENIN_EXAM_QUEST_ID } from "@/drizzle/constants";
import {
  accountDeletion,
  metaConsent,
  metaTracking,
  questHistory,
  storeUserIdAlias,
  userData,
} from "@/drizzle/schema";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import {
  captureMetaTracking,
  captureMetaTutorialCompletion,
  clearWithdrawnMetaTracking,
  deleteExpiredMetaTracking,
  markMetaConversionReported,
  recordMetaConsent,
  selectMetaConversions,
  withdrawMetaAccountConsent,
} from "@/queries/metaTracking";
import type { MetaTrackingInput } from "@/validators/metaTracking";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const input = (): MetaTrackingInput => ({
  revision: CONSENT_REVISION,
  consentId: crypto.randomUUID(),
  decidedAt: new Date(Date.now() - 10000).toISOString(),
  granted: true as const,
  fbc: `fb.1.${Date.now() - 20000}.Click_ID`,
});
const capture = async (tracking = input(), registrationAt?: Date) => {
  const db = await getTestDatabase();
  await recordMetaConsent(db, {
    ...tracking,
    decidedAt: new Date(tracking.decidedAt),
    userId: "player",
  });
  await captureMetaTracking(db, "player", tracking, "Test browser", registrationAt);
  return tracking;
};

describeWithDatabase("Meta consent and durable conversion receipts", () => {
  beforeEach(async () => {
    await resetTables(
      accountDeletion,
      storeUserIdAlias,
      userData,
      metaConsent,
      metaTracking,
      questHistory,
    );
    await insertUsers([{ userId: "player" }]);
  });

  it("keeps shared IDs through retries, settles only acknowledged actions, and retains browser receipts", async () => {
    const db = await getTestDatabase();
    const tracking = await capture(input(), new Date(Date.now() - 1000));
    const first = await selectMetaConversions(db, "register", { pendingOnly: true });
    expect(first).toHaveLength(1);
    await capture(tracking, new Date());
    const retry = await selectMetaConversions(db, "register", { pendingOnly: true });
    expect(retry[0]?.eventId).toBe(first[0]?.eventId);
    expect(retry[0]?.occurredAt).toEqual(first[0]?.occurredAt);
    await markMetaConversionReported(db, first[0]!, "register");
    expect(
      await selectMetaConversions(db, "register", { pendingOnly: true }),
    ).toHaveLength(0);
    expect((await selectMetaConversions(db, "register"))[0]?.eventId).toBe(
      first[0]?.eventId,
    );
  });

  it("never reports an existing account as a registration and requires confirmed tutorial completion after consent", async () => {
    const db = await getTestDatabase();
    await capture();
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    await db.insert(questHistory).values({
      id: "exam",
      questType: "tier",
      userId: "player",
      questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
      completed: 0,
      endAt: new Date(),
    });
    expect(await selectMetaConversions(db, "tutorial_complete")).toHaveLength(0);
    await db.update(questHistory).set({ completed: 1 });
    expect(await selectMetaConversions(db, "tutorial_complete")).toHaveLength(0);
    await captureMetaTutorialCompletion(db, "player", "Confirmed web browser");
    const confirmed = await selectMetaConversions(db, "tutorial_complete");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.userAgent).toBe("Confirmed web browser");
    await db.update(questHistory).set({ endAt: new Date(Date.now() - 20000) });
    expect(await selectMetaConversions(db, "tutorial_complete")).toHaveLength(0);
  });

  it("blocks delayed grants after signed-out withdrawal and erases matching data", async () => {
    const db = await getTestDatabase();
    const tracking = await capture(input(), new Date());
    const denial = {
      consentId: tracking.consentId,
      granted: false,
      decidedAt: new Date(),
    };
    await recordMetaConsent(db, denial);
    await clearWithdrawnMetaTracking(db, tracking.consentId);
    await capture(tracking, new Date());
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    const row = await db.query.metaTracking.findFirst();
    expect(row?.fbc).toBeNull();
    expect(row?.userAgent).toBe("");
    expect((await db.query.metaConsent.findFirst())?.granted).toBe(false);
  });

  it("lets denial win equal timestamps and ignores an obsolete withdrawal after a newer grant", async () => {
    const db = await getTestDatabase();
    const tracking = await capture(input(), new Date());
    await recordMetaConsent(db, {
      ...tracking,
      granted: false,
      decidedAt: new Date(tracking.decidedAt),
    });
    await capture(tracking);
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    const newer = { ...tracking, decidedAt: new Date(Date.now() - 1000).toISOString() };
    await capture(newer);
    await recordMetaConsent(db, {
      ...tracking,
      granted: false,
      decidedAt: new Date(tracking.decidedAt),
    });
    await clearWithdrawnMetaTracking(db, tracking.consentId);
    expect((await db.query.metaTracking.findFirst())?.fbc).toBe(tracking.fbc);
  });

  it("withdraws account attribution from another device and excludes expired retries", async () => {
    const db = await getTestDatabase();
    await capture(input(), new Date());
    await withdrawMetaAccountConsent(db, "player", new Date());
    await clearWithdrawnMetaTracking(db, crypto.randomUUID(), "player");
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    const old = {
      ...input(),
      decidedAt: new Date(Date.now() - 60 * 3600000).toISOString(),
    };
    await capture(old, new Date(Date.now() - 48 * 3600000));
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    await db.update(metaTracking).set({ expiresAt: new Date(Date.now() - 1000) });
    await db.update(metaConsent).set({ expiresAt: new Date(Date.now() - 1000) });
    await deleteExpiredMetaTracking(db);
    expect(await db.select().from(metaTracking)).toHaveLength(0);
    expect(
      await db.select().from(metaConsent).where(eq(metaConsent.userId, "player")),
    ).toHaveLength(0);
  });

  it("rejects obsolete policy grants, account-switch mismatches and conversions older than the retry window", async () => {
    const db = await getTestDatabase();
    const old = {
      ...input(),
      decidedAt: new Date(Date.now() - 60 * 3600000).toISOString(),
    };
    await capture(old, new Date(Date.now() - 48 * 3600000));
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    await db.update(metaTracking).set({ registrationAt: new Date() });
    expect(await selectMetaConversions(db, "register")).toHaveLength(1);
    await db.update(metaConsent).set({ revision: CONSENT_REVISION - 1 });
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    await db
      .update(metaConsent)
      .set({ revision: CONSENT_REVISION, userId: "another-player" });
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
  });

  it("lets account withdrawal win a decision recorded at exactly the same time on another device", async () => {
    const db = await getTestDatabase();
    const tracking = await capture(input(), new Date());
    await withdrawMetaAccountConsent(db, "player", new Date(tracking.decidedAt));
    await clearWithdrawnMetaTracking(db, crypto.randomUUID(), "player");
    expect(await selectMetaConversions(db, "register")).toHaveLength(0);
    expect((await db.query.metaTracking.findFirst())?.fbc).toBeNull();
  });

  it.each([
    "policy",
    "consent-expiry",
    "tracking-expiry",
    "decision",
    "owner",
    "retirement",
  ])("does not capture tutorial matching data after %s changes", async (reason) => {
    const db = await getTestDatabase();
    await capture();
    if (reason === "policy")
      await db.update(metaConsent).set({ revision: CONSENT_REVISION - 1 });
    if (reason === "consent-expiry")
      await db.update(metaConsent).set({ expiresAt: new Date(0) });
    if (reason === "tracking-expiry")
      await db.update(metaTracking).set({ expiresAt: new Date(0) });
    if (reason === "decision")
      await db.update(metaConsent).set({ decidedAt: new Date() });
    if (reason === "owner")
      await db.update(metaConsent).set({ userId: "another-player" });
    if (reason === "retirement")
      await db
        .insert(storeUserIdAlias)
        .values({ oldUserId: "player", newUserId: "deleted:test" });
    await captureMetaTutorialCompletion(db, "player", "Must not be retained");
    expect((await db.query.metaTracking.findFirst())?.tutorialUserAgent).toBeNull();
  });
});
