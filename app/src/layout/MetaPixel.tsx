"use client";

import { useEffect } from "react";
import { useCookieConsent } from "@/hooks/useCookieConsent";
import { useNativeShell } from "@/hooks/useNativeShell";
import { getMetaPixelTracker } from "@/libs/metaPixel";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector } from "@/utils/UserContext";

/** Load website acquisition tracking only after explicit marketing consent on web. */
export const MetaPixel = ({ pixelId }: { pixelId: string }) => {
  const marketingConsent = useCookieConsent("marketing");
  const isNativeShell = useNativeShell();
  const pathname = usePublicPathname();
  const { data: isExistingPlayer } = useUserDataSelector(() => true);

  useEffect(() => {
    const pixel = getMetaPixelTracker(pixelId);
    if (
      !marketingConsent ||
      isNativeShell !== false ||
      isNativeUserAgent(navigator.userAgent)
    ) {
      pixel.disable();
      return;
    }
    pixel.enable();
    return () => pixel.disable();
  }, [pixelId, marketingConsent, isNativeShell]);

  useEffect(() => {
    if (!marketingConsent || isNativeShell !== false) return;
    const pixel = getMetaPixelTracker(pixelId);
    pixel.pageView(pathname);
    if (isExistingPlayer) pixel.existingPlayer();
  }, [pixelId, marketingConsent, isNativeShell, pathname, isExistingPlayer]);

  return null;
};
