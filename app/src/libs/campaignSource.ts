import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/hooks/localstorage";
import { hasCookieConsent, hasDeclinedCookieConsent } from "@/libs/cookieConsent";

const CAMPAIGN_SOURCE_KEY = "utm_source";

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
