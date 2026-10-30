"use client";

import { useClerk } from "@clerk/nextjs";
import { useAtomValue, useStore } from "jotai";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Welcome from "@/layout/Welcome";
import { readCampaignSource } from "@/libs/campaignSource";
import { nativeHomeRedirectAtom } from "@/libs/native/homeRedirect";
import { useUserData } from "@/utils/UserContext";

/**
 * HomeLanding
 * - Client half of the landing page. Kept out of page.tsx so the route stays a server
 *   component and can export metadata with a canonical URL, which collapses the
 *   ?ref= and ?utm_source= referral variants of "/" into a single indexed page.
 */
export const HomeLanding: React.FC = () => {
  // Fetch data
  const { signOut } = useClerk();
  const {
    data: userData,
    status: userStatus,
    userId,
    isSignedIn,
    isClerkLoaded,
  } = useUserData();
  const setReferral = api.register.setReferralSource.useMutation();
  const utils = api.useUtils();
  const [isRetrying, setIsRetrying] = useState(false);

  // Navigation
  const router = useRouter();
  const store = useStore();
  const nativeRedirect = useAtomValue(nativeHomeRedirectAtom);

  // Redirect based on user status
  useEffect(() => {
    // Character data may outlive the session for a render during sign-out.
    if (!isClerkLoaded || !isSignedIn || !userId) return;
    // When user is signed in (Clerk) but has not created a character yet, set referral immediately
    if (isSignedIn && !userData && userStatus === "success") {
      setReferral.mutate({ utmSource: readCampaignSource() });
    }
    if (userStatus === "success" && !userData) {
      void router.push("/register");
    }
    if (userData && userId) {
      // Read at navigation time: a native callback can arrive after this render but
      // before its effect, and its destination must win over the default Profile.
      // NativeBridge already issued this destination. Even one duplicate push can
      // restart a slow route; character refreshes must leave it alone entirely.
      if (store.get(nativeHomeRedirectAtom)) return;
      void router.push("/profile");
    }
  }, [isClerkLoaded, isSignedIn, userData, userId, userStatus, store, nativeRedirect]);

  // A signed-in session can expire before the character query completes. Keep both
  // retry and sign-in available instead of trapping the player in the error boundary.
  // A failed background refetch still forwards when character data is already loaded.
  if (isSignedIn && !userData && (userStatus === "error" || isRetrying)) {
    return (
      <ContentBox title="Connection interrupted">
        <div className="flex flex-col gap-4 p-4">
          <p>
            We couldn&apos;t load your character. Check your connection and try again,
            or sign in again if your session has expired.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="min-h-12"
              disabled={isRetrying}
              onClick={async () => {
                setIsRetrying(true);
                try {
                  await utils.profile.getUser.invalidate();
                } finally {
                  setIsRetrying(false);
                }
              }}
            >
              {isRetrying ? "Trying again…" : "Try again"}
            </Button>
            <Button
              className="min-h-12"
              variant="outline"
              onClick={() => void signOut({ redirectUrl: "/login" })}
            >
              Sign in again
            </Button>
          </div>
        </div>
      </ContentBox>
    );
  }

  // Guard
  if (!isSignedIn) {
    return <Welcome />;
  } else {
    return <Loader explanation="Forwarding to profile" />;
  }
};

export default HomeLanding;
