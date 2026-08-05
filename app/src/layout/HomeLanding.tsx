"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
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
  const { data: userData, status: userStatus, userId } = useUserData();
  const setReferral = api.register.setReferralSource.useMutation();

  // Navigation
  const router = useRouter();

  // Redirect based on user status
  useEffect(() => {
    // When user is signed in (Clerk) but has not created a character yet, set referral immediately
    if (isSignedIn && !userData && userStatus !== "pending") {
      // attempt to read utm_source from localStorage if present
      const utm = safeLocalStorageGetItem("utm_source");
      setReferral.mutate({ utmSource: utm ?? undefined });
    }
    if (userStatus !== "pending" && !userData) {
      if (userStatus === "error") {
        void router.push("/500");
      } else {
        void router.push("/register");
      }
    }
    if (userData && userId) {
      void router.push("/profile");
    }
  }, [isSignedIn, userData, userId, userStatus]);

  // Guard
  if (!isSignedIn && !userData) {
    return <Welcome />;
  } else {
    return <Loader explanation="Forwarding to profile" />;
  }
};

export default HomeLanding;
