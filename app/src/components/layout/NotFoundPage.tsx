"use client";

import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { useUserInfo } from "@/utils/UserContext";

/** The in-shell 404 body, with links back into the game. */
export default function NotFoundPage() {
  // Signed-in players go straight to their profile; "/" would only forward them there.
  const { isSignedIn } = useUserInfo();
  const homeHref = isSignedIn ? "/profile" : "/";
  return (
    <ContentBox title="Not Found" subtitle="Error 404" defaultBackHref={homeHref}>
      <div className="flex flex-col items-start gap-3">
        <p>
          The page you are trying to access does not exist. It may have been removed, or
          the player you are looking for may have changed their name or left the game.
        </p>
        <div className="flex flex-row flex-wrap gap-4">
          <Link href={homeHref} className="font-bold underline">
            {isSignedIn ? "Return to your profile" : "Return to the front page"}
          </Link>
          <Link href="/users" className="font-bold underline">
            Browse players
          </Link>
          <Link href="/manual" className="font-bold underline">
            Open the manual
          </Link>
        </div>
      </div>
    </ContentBox>
  );
}
