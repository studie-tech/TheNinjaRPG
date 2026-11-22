import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { abEvent, adClick, visitorLog } from "@/drizzle/schema";
import { WALLPAPER_EXPERIMENT } from "@/libs/wallpaperExperiment";
import { miscRouter } from "@/server/api/routers/misc";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const CLICK_ID = "Cj0KCQiA-landing-click";

/** A signed-out landing visitor from the given country. */
const visitor = async (
  userCountry: string | undefined,
  userId: string | null = null,
  wallpaperVariant?: string,
) =>
  miscRouter.createCaller({
    drizzle: await getTestDatabase(),
    userId,
    userIp: "203.0.113.20",
    userAgent: "test",
    userCountry,
    wallpaperVariant,
  } as never);

const storedClicks = async () =>
  (await getTestDatabase())
    .select({ clickId: adClick.clickId, consent: adClick.adUserDataConsent })
    .from(adClick);

describeWithDatabase("ad click reports", () => {
  beforeEach(async () => {
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in ad click tests",
    });
    await resetTables(adClick, visitorLog, abEvent);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["winter", "spring", "unknown", null, undefined])(
    "records a visit with retired or absent wallpaper %s without attributing an exposure",
    async (wallpaperVariant) => {
      const result = await (await visitor("US", null, "hyorin")).trackVisitor({
        wallpaperVariant,
      });
      expect(result.success).toBe(true);
      const db = await getTestDatabase();
      expect(await db.select().from(visitorLog)).toHaveLength(1);
      expect(await db.select().from(abEvent)).toHaveLength(0);
    },
  );

  it.each(["hyorin", "tsukimori", "control"])(
    "attributes the matching current %s wallpaper",
    async (wallpaperVariant) => {
      const result = await (await visitor("US", null, wallpaperVariant)).trackVisitor({
        wallpaperVariant,
      });
      expect(result.success).toBe(true);
      const rows = await (await getTestDatabase()).select().from(abEvent);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        experiment: WALLPAPER_EXPERIMENT,
        variant: wallpaperVariant,
      });
    },
  );

  it("does not attribute an assignment that differs from the request cookie", async () => {
    expect(
      await (await visitor("US", null, "hyorin")).trackVisitor({
        wallpaperVariant: "tsukimori",
      }),
    ).toMatchObject({ success: true });
    expect(await (await getTestDatabase()).select().from(abEvent)).toHaveLength(0);
  });

  it("keeps a granted click anywhere and an unanswered one only outside the EEA", async () => {
    const unanswered = {
      adClick: {
        clickId: CLICK_ID,
        clickIdType: "gclid",
        marketingConsent: "unanswered",
      },
    } as const;
    expect(await (await visitor("DE")).trackVisitor(unanswered)).toMatchObject({
      success: true,
      isAdClickKept: false,
    });
    expect(await (await visitor(undefined)).trackVisitor(unanswered)).toMatchObject({
      isAdClickKept: false,
    });
    expect(await storedClicks()).toEqual([]);

    expect(await (await visitor("US")).trackVisitor(unanswered)).toMatchObject({
      isAdClickKept: true,
    });
    expect(await storedClicks()).toEqual([
      { clickId: CLICK_ID, consent: "unanswered" },
    ]);

    const granted = {
      adClick: { ...unanswered.adClick, marketingConsent: "granted" },
    } as const;
    expect(await (await visitor("DE")).trackVisitor(granted)).toMatchObject({
      isAdClickKept: true,
    });
    expect(await storedClicks()).toEqual([{ clickId: CLICK_ID, consent: "granted" }]);
  });

  it("records the visit but not a malformed click ID", async () => {
    const result = await (await visitor("US")).trackVisitor({
      adClick: {
        clickId: "not a click id",
        clickIdType: "gclid",
        marketingConsent: "granted",
      },
    });
    expect(result).toMatchObject({ success: true, isAdClickKept: false });
    expect(await storedClicks()).toEqual([]);
    expect(await (await getTestDatabase()).select().from(visitorLog)).toHaveLength(1);
  });

  it("forgets the visitor's click, and has nothing to forget without one", async () => {
    await (await visitor("US")).trackVisitor({
      adClick: { clickId: CLICK_ID, clickIdType: "gclid", marketingConsent: "granted" },
    });
    expect(await (await visitor("US")).withdrawAdClickConsent({})).toEqual({
      success: true,
      message: "No ad click to forget",
    });
    expect(await storedClicks()).toHaveLength(1);
    expect(
      await (await visitor("US")).withdrawAdClickConsent({ clickId: CLICK_ID }),
    ).toEqual({ success: true, message: "Ad click forgotten" });
    expect(await storedClicks()).toEqual([]);
  });

  it("forgets a signed-in visitor's unlinked and linked clicks together", async () => {
    const db = await getTestDatabase();
    const click = {
      clickIdType: "gclid",
      ipHash: "hash",
      adUserDataConsent: "granted",
    } as const;
    await db.insert(adClick).values([
      { ...click, id: "unlinked", clickId: CLICK_ID },
      { ...click, id: "mine", clickId: "Cj0KCQiA-mine", userId: "player" },
      { ...click, id: "other", clickId: "Cj0KCQiA-other", userId: "other" },
    ]);
    expect(
      await (await visitor("US", "player")).withdrawAdClickConsent({
        clickId: CLICK_ID,
      }),
    ).toEqual({ success: true, message: "Ad click forgotten" });
    expect((await storedClicks()).map((row) => row.clickId)).toEqual([
      "Cj0KCQiA-other",
    ]);
  });
});
