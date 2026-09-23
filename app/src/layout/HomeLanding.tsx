"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Welcome from "@/layout/Welcome";
import { useUserData } from "@/utils/UserContext";

/**
 * HomeLanding
 * - Client half of the landing page. Kept out of page.tsx so the route stays a server
 *   component and can export metadata with a canonical URL, which collapses the
 *   ?ref= and ?utm_source= referral variants of "/" into a single indexed page.
 */
export const HomeLanding: React.FC = () => {
  // Fetch data
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { data: userData, status: userStatus, userId } = useUserData();
  const setReferral = api.register.setReferralSource.useMutation();
  const utils = api.useUtils();
  const [isRetrying, setIsRetrying] = useState(false);

  // Navigation
  const router = useRouter();

  // Redirect based on user status
  useEffect(() => {
    // When user is signed in (Clerk) but has not created a character yet, set referral immediately
    if (isSignedIn && !userData && userStatus === "success") {
      // attempt to read utm_source from localStorage if present
      const utm = safeLocalStorageGetItem("utm_source");
      setReferral.mutate({ utmSource: utm ?? undefined });
    }
    if (userStatus === "success" && !userData) {
      void router.push("/register");
    }
    if (userData && userId) {
      void router.push("/profile");
    }
  }, [isSignedIn, userData, userId, userStatus]);

  // A signed-in session can expire before the character query completes. Keep both
  // retry and sign-in available instead of trapping the player in the error boundary.
  // A failed background refetch still forwards when character data is already loaded.
  if (isSignedIn && userStatus === "error" && !userData) {
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
  if (!isSignedIn && !userData) {
    return <Welcome />;
  } else {
    return <Loader explanation="Forwarding to profile" />;
  }
};

export default HomeLanding;
