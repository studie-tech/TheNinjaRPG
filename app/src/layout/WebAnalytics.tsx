"use client";

import { GoogleTagManager } from "@next/third-parties/google";
import { useNativeShell } from "@/hooks/useNativeShell";
import { isNativeUserAgent } from "@/libs/native/userAgent";

export const WebAnalytics = ({ gtmId }: { gtmId: string }) => {
  const isNativeShell = useNativeShell();

  // Advertising scripts must wait for the actual client, even when a cached page
  // or intermediary supplied web markup to a native WebView.
  if (isNativeShell !== false || isNativeUserAgent(navigator.userAgent)) return null;
  return <GoogleTagManager gtmId={gtmId} />;
};
