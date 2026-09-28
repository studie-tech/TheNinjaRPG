"use client";

import { useSyncExternalStore } from "react";
import {
  type ConsentCategory,
  hasCookieConsent,
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
