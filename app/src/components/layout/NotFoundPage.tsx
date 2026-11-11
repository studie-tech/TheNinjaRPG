"use client";

import type React from "react";
import { NOT_FOUND_LINKS, type NotFoundLink } from "@/components/layout/notFoundLinks";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { useUserInfo } from "@/utils/UserContext";

/**
 * The in-shell 404 body, with links back into the game. Routes pass their own message and
 * links so the page speaks to what was missing, such as a player, guide or forum board.
 */
export default function NotFoundPage({
  message = "The page you are trying to access does not exist. It may have been removed or moved.",
  links = NOT_FOUND_LINKS,
  defaultBackHref,
}: NotFoundPageProps) {
  // Signed-in players go straight to their profile; "/" would only forward them there.
  const { isSignedIn } = useUserInfo();
  const homeHref = isSignedIn ? "/profile" : "/";
  const shownLinks = links.map((link) =>
    link.href === "/" && isSignedIn
      ? { href: "/profile", label: "Return to your profile" }
      : link,
  );
  return (
    <ContentBox
      title="Not Found"
      subtitle="Error 404"
      defaultBackHref={defaultBackHref ?? homeHref}
    >
      <div className="flex flex-col items-start gap-3">
        <p>{message}</p>
        <div className="flex flex-row flex-wrap gap-4">
          {shownLinks.map((link) => (
            <Link key={link.href} href={link.href} className="link-inline">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </ContentBox>
  );
}

interface NotFoundPageProps {
  message?: React.ReactNode;
  links?: readonly NotFoundLink[];
  defaultBackHref?: string;
}
