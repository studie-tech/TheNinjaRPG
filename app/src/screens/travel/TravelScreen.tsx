"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { useNavigationRouter } from "@/hooks/navigation";
import { useTravelSession } from "@/hooks/useTravelSession";
import type { HeaderActionItem } from "@/layout/ContentBoxHeaderActions";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { TravelView } from "@/screens/travel/TravelView";
import { useAwake, usePublicPathname } from "@/utils/routing";
import { travelLocationSchema } from "@/validators/travel";

/** Host the travel session in a route or retained map viewport with a loading boundary. */
export function TravelScreen({
  immersive = false,
  isInteractive = true,
  headerItems,
}: TravelScreenProps) {
  return (
    <Suspense fallback={<Loader explanation="Loading travel" />}>
      <TravelRoute
        immersive={immersive}
        isInteractive={isInteractive}
        headerItems={headerItems}
      />
    </Suspense>
  );
}

/** Travel owns URL requests and redirects; the session can be hosted independently. */
function TravelRoute({ immersive, isInteractive, headerItems }: TravelScreenProps) {
  const session = useTravelSession();
  const { userData, setLocationRequest } = session;
  const searchParams = useSearchParams();
  const pathname = usePublicPathname();
  const requestedLocationRef = useRef<string | null>(null);
  const router = useNavigationRouter();

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

  const view = (
    <TravelView
      session={session}
      hasLocationRequest={searchParams.has("sector")}
      headerItems={headerItems}
      immersive={immersive}
      isInteractive={isInteractive}
    />
  );
  return immersive ? <div className="experimental-travel">{view}</div> : view;
}

interface TravelScreenProps {
  headerItems?: HeaderActionItem[];
  immersive?: boolean;
  isInteractive?: boolean;
}
