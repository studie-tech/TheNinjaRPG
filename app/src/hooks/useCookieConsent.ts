"use client";

import { useSyncExternalStore } from "react";
import { type MarketingConsent, readMarketingConsent } from "@/libs/campaignSource";
import {
  type ConsentCategory,
  hasCookieConsent,
  isCookieConsentKnown,
  subscribeToCookieConsent,
} from "@/libs/cookieConsent";

/**
 * Whether the visitor has opted into a Cookiebot category. The server snapshot is
 * always false, so consent-gated content hydrates in its declined state and switches
 * over once Cookiebot reports consent.
 */
export const useCookieConsent = (category: ConsentCategory): boolean =>
  useSyncExternalStore(
    subscribeToCookieConsent,
    () => hasCookieConsent(category),
    () => false,
  );

/** Whether Cookiebot has loaded, so a choice not yet read is no longer mistaken for none. */
export const useCookieConsentKnown = (): boolean =>
  useSyncExternalStore(subscribeToCookieConsent, isCookieConsentKnown, () => false);

/**
 * The marketing cookie choice as granted, declined or unanswered, so a change between
 * unanswered and declined re-renders too. Declined until Cookiebot has loaded.
 */
export const useMarketingConsent = (): MarketingConsent =>
  useSyncExternalStore<MarketingConsent>(
    subscribeToCookieConsent,
    readMarketingConsent,
    () => "declined",
  );
