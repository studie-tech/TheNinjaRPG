"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useContext, useEffect, useRef } from "react";
import { useNavigationRouter } from "@/hooks/navigation";
import { useTravelSession } from "@/hooks/useTravelSession";
import { REVEAL_CONTENT_BOX_CONTROLS } from "@/layout/ContentBoxHeaderActions";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { TravelNavigationContext } from "@/screens/travel/TravelNavigationContext";
import { TravelView } from "@/screens/travel/TravelView";
import { useAwake, usePublicPathname } from "@/utils/routing";
import { travelLocationSchema } from "@/validators/travel";

/** Host the travel session in a route or retained map viewport with a loading boundary. */
export function TravelScreen({
  immersive = false,
  isInteractive = true,
}: TravelScreenProps) {
  return (
    <Suspense fallback={<Loader explanation="Loading travel" />}>
      <TravelRoute immersive={immersive} isInteractive={isInteractive} />
    </Suspense>
  );
}

/** Travel owns URL requests and redirects; the session can be hosted independently. */
function TravelRoute({ immersive, isInteractive }: TravelScreenProps) {
  const session = useTravelSession(isInteractive);
  const { userData, setLocationRequest } = session;
  const searchParams = useSearchParams();
  const pathname = usePublicPathname();
  const requestedLocationRef = useRef<string | null>(null);
  const router = useNavigationRouter();
  const navigation = useContext(TravelNavigationContext);
  const { setActiveTab, globalLink } = session;

  useEffect(() => {
    if (isInteractive && userData?.status === "BATTLE") {
      // Not pushToCombat: this is the guard that bounces a battling player off the map, and it
      // has to fire again every time they come back to it, including with the same battle
      void router.push(`/combat`);
    }
  }, [isInteractive, userData?.status, router]);

  useAwake(isInteractive ? userData : undefined, { allowActionRecovery: true });

  useEffect(() => {
    if (pathname !== "/travel" || !searchParams.has("sector")) {
      requestedLocationRef.current = null;
      return;
    }
    if (!userData) return;
    const key = searchParams.toString();
    if (requestedLocationRef.current === key) return;
    requestedLocationRef.current = key;
    const parsed = travelLocationSchema.safeParse({
      sector: searchParams.get("sector"),
      longitude: searchParams.get("longitude") ?? undefined,
      latitude: searchParams.get("latitude") ?? undefined,
    });
    router.replace("/travel", { scroll: false });
    if (parsed.success) setLocationRequest(parsed.data);
    else showMutationToast({ success: false, message: "Invalid travel location" });
  }, [pathname, searchParams, userData, router, setLocationRequest]);

  useEffect(() => {
    if (
      !immersive ||
      !isInteractive ||
      !userData ||
      pathname !== "/travel" ||
      searchParams.has("sector")
    )
      return;
    const openControls = searchParams.get("controls") === "open";
    const showGlobal = searchParams.get("view") === "global";
    if (!openControls && !showGlobal) return;
    const disclosure = navigation?.controls?.querySelector(
      "[data-content-box-actions]",
    );
    if (!disclosure) return;
    if (showGlobal) setActiveTab(globalLink);
    if (openControls) disclosure.dispatchEvent(new Event(REVEAL_CONTENT_BOX_CONTROLS));
    const remaining = new URLSearchParams(searchParams.toString());
    if (openControls) remaining.delete("controls");
    if (showGlobal) remaining.delete("view");
    router.replace(`/travel${remaining.size ? `?${remaining}` : ""}`, {
      scroll: false,
    });
  }, [
    immersive,
    isInteractive,
    userData,
    pathname,
    searchParams,
    navigation,
    setActiveTab,
    globalLink,
    router,
  ]);

  const view = (
    <TravelView
      session={session}
      hasLocationRequest={searchParams.has("sector")}
      immersive={immersive}
      isInteractive={isInteractive}
    />
  );
  return immersive ? <div className="sector-travel">{view}</div> : view;
}

interface TravelScreenProps {
  immersive?: boolean;
  isInteractive?: boolean;
}
