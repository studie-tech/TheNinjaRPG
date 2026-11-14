import { type AdClickIdType, AdClickIdTypes } from "@/drizzle/constants";
import {
  hasCookieConsent,
  hasDeclinedCookieConsent,
  isCookieConsentKnown,
} from "@/libs/cookieConsent";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/utils/storage";

const CAMPAIGN_SOURCE_KEY = "utm_source";

/** Keep recruiter and consented campaign attribution before leaving a referral landing. */
export const storeLandingAttribution = (
  searchParams: Pick<URLSearchParams, "get"> | null,
) => {
  const ref = searchParams?.get("ref");
  if (ref) safeLocalStorageSetItem("ref", ref);
  const source = searchParams?.get("utm_source");
  if (source) storeCampaignSource(source);
};

/**
 * The campaign a visitor arrived from is kept on the device until registration only with
 * statistics consent. Without it, registration attributes the account to the visit logged
 * under the hash of its IP instead.
 */
export const storeCampaignSource = (source: string) => {
  if (hasCookieConsent("statistics"))
    safeLocalStorageSetItem(CAMPAIGN_SOURCE_KEY, source);
};

/**
 * The stored campaign source, while statistics consent holds. A source stored before the
 * visitor declined or withdrew consent is deleted here.
 */
export const readCampaignSource = (): string | undefined => {
  if (hasCookieConsent("statistics")) {
    return safeLocalStorageGetItem(CAMPAIGN_SOURCE_KEY) ?? undefined;
  }
  if (hasDeclinedCookieConsent("statistics")) {
    safeLocalStorageRemoveItem(CAMPAIGN_SOURCE_KEY);
  }
  return undefined;
};

/**
 * The visitor's marketing cookie choice. Until Cookiebot has loaded the choice is unknown,
 * and it is treated as declined, like everywhere Cookiebot is absent (blockers, the native
 * shell): a stored "no" must never be read as an unanswered dialog.
 */
export const readMarketingConsent = (): MarketingConsent => {
  if (!isCookieConsentKnown() || hasDeclinedCookieConsent("marketing"))
    return "declined";
  if (hasCookieConsent("marketing")) return "granted";
  return "unanswered";
};

const AD_CLICK_KEY = "ad_click";
const AD_CLICK_WITHDRAWN_KEY = "ad_click_withdrawn";

/** The first Google Ads click identifier in a landing URL. */
export const readLandingAdClick = (
  searchParams: Pick<URLSearchParams, "get"> | null,
): { clickId: string; clickIdType: AdClickIdType } | undefined => {
  for (const clickIdType of AdClickIdTypes) {
    const clickId = searchParams?.get(clickIdType);
    if (clickId) return { clickId, clickIdType };
  }
  return undefined;
};

/**
 * Remember a click the server kept, so a visitor who registers weeks later on this device
 * is credited to it. Character creation sends it, and declining marketing cookies forgets it.
 */
export const storeAdClick = (clickId: string) =>
  safeLocalStorageSetItem(AD_CLICK_KEY, clickId);

/** The click identifier stored on this device, if any. */
export const readStoredAdClick = (): string | undefined =>
  safeLocalStorageGetItem(AD_CLICK_KEY) ?? undefined;

/**
 * Record that the stored click now belongs to this device's character, which a later
 * decline must withdraw again from whichever account is signed in.
 */
export const markAdClickLinked = () => {
  safeLocalStorageRemoveItem(AD_CLICK_KEY);
  safeLocalStorageRemoveItem(AD_CLICK_WITHDRAWN_KEY);
};

/** Forget the click this device kept for a later registration. */
export const clearAdClick = () => safeLocalStorageRemoveItem(AD_CLICK_KEY);

/** Whether this device already withdrew the account's ad click after a decline. */
export const hasWithdrawnAdClickFor = (userId: string | undefined) =>
  Boolean(userId) && safeLocalStorageGetItem(AD_CLICK_WITHDRAWN_KEY) === userId;

/** Remember that this account's ad click was withdrawn, so it is not withdrawn again. */
export const recordAdClickWithdrawn = (userId: string) =>
  safeLocalStorageSetItem(AD_CLICK_WITHDRAWN_KEY, userId);

/** The visitor's marketing cookie choice; "declined" until Cookiebot has loaded. */
export type MarketingConsent = "granted" | "declined" | "unanswered";
