"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useCookieConsent, useCookieConsentKnown } from "@/hooks/useCookieConsent";
import { useNativeShell } from "@/hooks/useNativeShell";
import { subscribeToCookieConsent } from "@/libs/cookieConsent";
import { getMetaPixelTracker } from "@/libs/metaPixel";
import {
  clearMetaClick,
  META_CONVERSION_EVENT,
  META_READY_EVENT,
  readMetaConsent,
  readMetaTracking,
} from "@/libs/metaTracking";
import { isNativeUserAgent } from "@/libs/native/userAgent";

/** Synchronize withdrawals and use server-confirmed IDs for optional browser conversions. */
export const MetaTrackingConsent = ({ pixelId }: { pixelId: string }) => {
  const known = useCookieConsentKnown();
  const granted = useCookieConsent("marketing");
  const native = useNativeShell();
  const { isLoaded, isSignedIn, user } = useUser();
  const userId = isSignedIn ? user?.id : undefined;
  const { mutate: synchronize } = api.meta.synchronizeConsent.useMutation({
    // No game action depends on tracking. Failed synchronization retries on the next visit.
    meta: { handlesTransportError: true },
    onMutate: () => ({ userId }),
    onSuccess: (events, input, context) => {
      const current = readMetaConsent();
      if (
        !input.granted ||
        !current?.granted ||
        context?.userId !== userId ||
        current.consentId !== input.consentId ||
        current.decidedAt !== input.decidedAt
      )
        return;
      for (const row of events)
        getMetaPixelTracker(pixelId).confirmedConversion(row.event, row.eventId);
    },
  });
  useEffect(() => {
    if (
      !known ||
      !isLoaded ||
      native !== false ||
      isNativeUserAgent(navigator.userAgent)
    )
      return;
    const sync = () => {
      const consent = readMetaConsent();
      if (!consent) return;
      if (!consent.granted) {
        clearMetaClick();
        synchronize({ ...consent, granted: false });
      } else {
        const tracking = readMetaTracking();
        if (tracking) synchronize(tracking);
      }
    };
    sync();
    const unsubscribe = subscribeToCookieConsent(sync);
    window.addEventListener(META_CONVERSION_EVENT, sync);
    window.addEventListener(META_READY_EVENT, sync);
    return () => {
      unsubscribe();
      window.removeEventListener(META_CONVERSION_EVENT, sync);
      window.removeEventListener(META_READY_EVENT, sync);
    };
  }, [known, granted, native, isLoaded, userId, synchronize]);
  return null;
};
