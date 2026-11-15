"use client";

import type React from "react";
import { lazy, Suspense } from "react";
import { api } from "@/app/_trpc/client";
import type { PublicUserComponentProps } from "@/layout/PublicUser";
import { PublicUserSkeleton } from "@/layout/publicUser/PublicUserSkeleton";
import { useUserData } from "@/utils/UserContext";

const PublicUserComponent = lazy(() => import("@/layout/PublicUser"));

/**
 * Public profile card for pages that show it beside their own content (a sensei, a Kage).
 * The full component carries the staff and moderation tooling, so it loads as its own chunk
 * behind the profile skeleton. The profile query starts here, alongside the chunk download.
 */
export const LazyPublicUser: React.FC<PublicUserComponentProps> = (props) => {
  const { isSignedIn } = useUserData();
  api.profile.getPublicUser.useQuery(
    { userId: props.userId },
    { enabled: !!props.userId },
  );
  return (
    <Suspense
      fallback={
        <PublicUserSkeleton
          title={props.title}
          subtitle={props.subtitle}
          defaultBackHref={props.defaultBackHref}
          initialBreak={props.initialBreak}
          isGuest={!isSignedIn}
          seed={props.initialProfile}
        />
      }
    >
      <PublicUserComponent {...props} />
    </Suspense>
  );
};
