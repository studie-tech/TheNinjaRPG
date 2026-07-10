"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import Loader from "@/layout/Loader";
import Welcome from "@/layout/Welcome";
import { useUserData } from "@/utils/UserContext";

export default function Index() {
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
}
