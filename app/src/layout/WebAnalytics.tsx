"use client";

import { GoogleTagManager } from "@next/third-parties/google";
import { useCookieConsent, useCookieConsentKnown } from "@/hooks/useCookieConsent";
import { useNativeShell } from "@/hooks/useNativeShell";
import { isNativeUserAgent } from "@/libs/native/userAgent";

export const WebAnalytics = ({ gtmId }: { gtmId: string }) => {
  const isNativeShell = useNativeShell();
  const isConsentKnown = useCookieConsentKnown();
  const hasStatistics = useCookieConsent("statistics");
  const hasMarketing = useCookieConsent("marketing");

  // Advertising scripts must wait for the actual client, even when a cached page
  // or intermediary supplied web markup to a native WebView.
  if (
    isNativeShell !== false ||
    isNativeUserAgent(navigator.userAgent) ||
    !isConsentKnown ||
    (!hasStatistics && !hasMarketing)
  )
    return null;
  return <GoogleTagManager gtmId={gtmId} />;
};
