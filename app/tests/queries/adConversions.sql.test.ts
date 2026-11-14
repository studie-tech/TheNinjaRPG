import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { TUTORIAL_GENIN_EXAM_QUEST_ID } from "@/drizzle/constants";
import { adClick, adConversionUpload, questHistory, userData } from "@/drizzle/schema";
import {
  deleteAdConversionUploads,
  deleteLinkedAdClicksForWithdrawnConsent,
  deleteUnlinkedAdClickForWithdrawnConsent,
  findLatestUnlinkedAdClickByIp,
  findUnlinkedAdClickByClickId,
  insertAdClickForTrackVisitor,
  insertAdConversionUploads,
  linkAdClickToUser,
  markAdConversionsReported,
  selectAdConversionUploads,
  selectPendingRegisterAdConversions,
  selectPendingTutorialAdConversions,
} from "@/queries/adConversions";
import { deleteAdClickForGET } from "@/queries/cleaner";
import {
  AD_CLICK_IP_LINK_DAYS,
  AD_CLICK_RETENTION_DAYS,
} from "@/server/utils/adConversions";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const IP = "203.0.113.7";
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

const insertClick = async (
  clickId: string,
  overrides: Partial<typeof adClick.$inferInsert> = {},
) => {
  const db = await getTestDatabase();
  await insertAdClickForTrackVisitor(db, {
    clickId,
    clickIdType: "gclid",
    ip: IP,
    consent: "unanswered",
  });
  if (Object.keys(overrides).length > 0) {
    await db.update(adClick).set(overrides).where(eq(adClick.clickId, clickId));
  }
  const [row] = await db.select().from(adClick).where(eq(adClick.clickId, clickId));
  if (!row) throw new Error(`click ${clickId} was not stored`);
  return row;
};

describeWithDatabase("Google Ads click conversions", () => {
  beforeEach(async () => {
    await resetTables(adClick, adConversionUpload, questHistory, userData);
  });

  it("keeps one row per click and upgrades it once consent is granted", async () => {
    const db = await getTestDatabase();
    const click = {
      clickId: "Cj0KCQiA-first-click",
      clickIdType: "gbraid" as const,
      ip: IP,
    };
    await insertAdClickForTrackVisitor(db, { ...click, consent: "unanswered" });
    await insertAdClickForTrackVisitor(db, { ...click, consent: "granted" });
    await insertAdClickForTrackVisitor(db, { ...click, consent: "unanswered" });
    const rows = await db.select().from(adClick);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.adUserDataConsent).toBe("granted");
    expect(rows[0]?.clickIdType).toBe("gbraid");
  });

  it("keeps the registrant's consent when a linked click is reported again", async () => {
    const db = await getTestDatabase();
    const linked = await insertClick("Cj0KCQiA-linked-again", { userId: "player" });
    await insertAdClickForTrackVisitor(db, {
      clickId: linked.clickId,
      clickIdType: "gclid",
      ip: IP,
      consent: "granted",
    });
    const [row] = await db.select().from(adClick).where(eq(adClick.id, linked.id));
    expect(row?.adUserDataConsent).toBe("unanswered");
  });

  it("finds a stored click for weeks and an IP match only within its window", async () => {
    const db = await getTestDatabase();
    const expired = await insertClick("Cj0KCQiA-expired", {
      createdAt: daysAgo(AD_CLICK_RETENTION_DAYS + 1),
    });
    expect(await findUnlinkedAdClickByClickId(db, expired.clickId)).toBeUndefined();
    const weeksOld = await insertClick("Cj0KCQiA-weeks-old", {
      createdAt: daysAgo(AD_CLICK_RETENTION_DAYS - 1),
    });
    expect(await findUnlinkedAdClickByClickId(db, weeksOld.clickId)).toEqual({
      id: weeksOld.id,
    });
    expect(await findLatestUnlinkedAdClickByIp(db, IP)).toBeUndefined();

    const recent = await insertClick("Cj0KCQiA-recent", {
      createdAt: daysAgo(AD_CLICK_IP_LINK_DAYS - 1),
    });
    expect(await findLatestUnlinkedAdClickByIp(db, IP)).toEqual({ id: recent.id });
    expect(await findLatestUnlinkedAdClickByIp(db, "198.51.100.1")).toBeUndefined();

    await linkAdClickToUser(db, {
      id: recent.id,
      userId: "player",
      consent: "granted",
    });
    // A second character cannot take a click that is already linked.
    await linkAdClickToUser(db, { id: recent.id, userId: "other", consent: "granted" });
    const [linked] = await db.select().from(adClick).where(eq(adClick.id, recent.id));
    expect(linked?.userId).toBe("player");
    expect(await findUnlinkedAdClickByClickId(db, recent.clickId)).toBeUndefined();
    expect(await findLatestUnlinkedAdClickByIp(db, IP)).toBeUndefined();
  });

  it("lists unsent conversions after their click until they are reported", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "player" }, { userId: "organic" }]);
    const linked = await insertClick("Cj0KCQiA-linked", {
      userId: "player",
      adUserDataConsent: "granted",
      createdAt: daysAgo(1),
    });
    // A click linked after the account's conversions did not cause them.
    await insertClick("Cj0KCQiA-later", {
      userId: "organic",
      createdAt: new Date(Date.now() + 60_000),
    });
    const examEndAt = new Date();
    await db.insert(questHistory).values(
      ["player", "organic"].map((userId) => ({
        id: `exam-${userId}`,
        userId,
        questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
        questType: "tier" as const,
        completed: 1,
        endAt: examEndAt,
      })),
    );

    const registers = await selectPendingRegisterAdConversions(db, 100);
    expect(registers.map((row) => [row.adClickId, row.consent])).toEqual([
      [linked.id, "granted"],
    ]);
    const tutorials = await selectPendingTutorialAdConversions(db, 100);
    expect(tutorials.map((row) => [row.adClickId, row.convertedAt])).toEqual([
      [linked.id, examEndAt],
    ]);

    // A conversion awaiting Google's status is not sent again.
    await insertAdConversionUploads(db, "request-1", [
      { adClickId: linked.id, action: "register" },
    ]);
    expect(await selectPendingRegisterAdConversions(db, 100)).toEqual([]);
    expect(await selectPendingTutorialAdConversions(db, 100)).toHaveLength(1);
    const uploads = await selectAdConversionUploads(db, 100);
    expect(uploads.map((upload) => [upload.requestId, upload.eventIndex])).toEqual([
      ["request-1", 0],
    ]);
    await deleteAdConversionUploads(
      db,
      uploads.map((upload) => upload.id),
    );
    expect(await selectPendingRegisterAdConversions(db, 100)).toHaveLength(1);

    await markAdConversionsReported(db, "register", [linked.id]);
    expect(await selectPendingRegisterAdConversions(db, 100)).toEqual([]);
    expect(await selectPendingTutorialAdConversions(db, 100)).toHaveLength(1);
    await markAdConversionsReported(db, "tutorialComplete", [linked.id]);
    expect(await selectPendingTutorialAdConversions(db, 100)).toEqual([]);
  });

  it("forgets the visitor's own clicks when consent is withdrawn", async () => {
    const db = await getTestDatabase();
    await insertClick("Cj0KCQiA-unlinked");
    await insertClick("Cj0KCQiA-linked-mine", { userId: "player" });
    await insertClick("Cj0KCQiA-linked-other", { userId: "other" });
    // Naming someone else's linked click does not delete it.
    await deleteUnlinkedAdClickForWithdrawnConsent(db, "Cj0KCQiA-linked-other");
    await deleteUnlinkedAdClickForWithdrawnConsent(db, "Cj0KCQiA-unlinked");
    await deleteLinkedAdClicksForWithdrawnConsent(db, "player");
    const remaining = await db.select({ clickId: adClick.clickId }).from(adClick);
    expect(remaining.map((row) => row.clickId)).toEqual(["Cj0KCQiA-linked-other"]);
  });

  it("expires clicks after Google's 90-day window", async () => {
    const db = await getTestDatabase();
    await insertClick("Cj0KCQiA-fresh", {
      createdAt: daysAgo(AD_CLICK_RETENTION_DAYS - 1),
    });
    await insertClick("Cj0KCQiA-expired", {
      createdAt: daysAgo(AD_CLICK_RETENTION_DAYS + 1),
    });
    await insertClick("Cj0KCQiA-expired-linked", {
      userId: "veteran",
      createdAt: daysAgo(AD_CLICK_RETENTION_DAYS + 1),
    });
    await deleteAdClickForGET(db, 100);
    const remaining = await db.select({ clickId: adClick.clickId }).from(adClick);
    expect(remaining.map((row) => row.clickId)).toEqual(["Cj0KCQiA-fresh"]);
  });
});
