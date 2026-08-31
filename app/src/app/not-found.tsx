import Link from "next/link";
import ContentBox from "@/layout/ContentBox";

/**
 * Rendered whenever a route calls notFound().
 *
 * global-not-found.tsx only covers URLs that match no route at all. Without this file
 * Next falls back to its built-in page, which injects `body{background:#fff}` and a
 * full-height centred block inside the still-rendered game chrome. Routes that call
 * notFound() -- the profile pages, and the manual detail pages before them -- looked
 * broken rather than merely empty.
 */
export default function NotFound() {
  return (
    <ContentBox title="Not Found" subtitle="Error 404" defaultBackHref="/">
      <div className="flex flex-col items-start gap-3">
        <p>
          The page you are trying to access does not exist. It may have been removed, or
          the player you are looking for may have changed their name or left the game.
        </p>
        <div className="flex flex-row flex-wrap gap-4">
          <Link href="/" className="font-bold underline">
            Return to the front page
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
