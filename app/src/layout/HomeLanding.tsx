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

  // The query is only enabled for a signed-in visitor, so an error without data is a
  // character that failed to load, not one that does not exist. The segment's error
  // boundary shows it with a retry; there is no /500 route to send them to. A failed
  // background refetch keeps the loaded character and still forwards to the profile.
  if (userStatus === "error" && !userData) {
    throw new Error("Your character could not be loaded");
  }

  // Guard
  if (!isSignedIn && !userData) {
    return <Welcome />;
  } else {
    return <Loader explanation="Forwarding to profile" />;
  }
};

export default HomeLanding;
