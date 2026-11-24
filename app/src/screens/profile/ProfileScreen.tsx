import { Suspense } from "react";
import Loader from "@/layout/Loader";
import { Profile } from "@/layout/Profile";

/** Render the profile screen independently of its route adapter. */
export function ProfileScreen() {
  return (
    <Suspense fallback={<Loader explanation="Loading profile page..." />}>
      <Profile />
    </Suspense>
  );
}
