"use client";

import type { ReactNode } from "react";
import type { SplashAnnouncement } from "@/drizzle/schema";
import Image from "@/layout/Image";
import Link from "@/layout/Link";

/** Flow naturally sized announcements and rewards into balanced columns at the container width. */
export function WelcomeBoard({
  announcements,
  onNavigate,
  leadingContent,
}: {
  announcements: readonly AnnouncementCard[];
  onNavigate?: () => void;
  leadingContent?: ReactNode;
}) {
  const cardCount = announcements.length + (leadingContent ? 1 : 0);
  return (
    <div className="@container min-w-0">
      <div
        className={`columns-1 gap-4 ${cardCount > 1 ? "@min-[36rem]:columns-2" : ""} ${cardCount > 2 ? "@min-[64rem]:columns-3" : ""}`}
      >
        {leadingContent && (
          <div className="mb-4 break-inside-avoid">{leadingContent}</div>
        )}
        {announcements.map((entry) => (
          <article
            key={entry.id}
            className="mb-4 min-w-0 break-inside-avoid overflow-hidden rounded-sm border-2 border-border bg-card text-card-foreground shadow-sm"
          >
            <h3 className="border-b-2 border-border bg-primary px-4 py-2 font-serif text-xl font-bold text-primary-foreground break-words">
              {entry.name}
            </h3>
            <div className="flex items-start gap-4 p-4">
              {entry.image && (
                <Image
                  src={entry.image}
                  alt=""
                  width={112}
                  height={128}
                  className="aspect-[7/8] w-[26%] max-w-28 shrink-0 rounded-sm object-cover"
                />
              )}
              <div className="min-w-0 space-y-3">
                <p className="text-base leading-relaxed whitespace-pre-line break-words">
                  {entry.description}
                </p>
                <Link
                  href={entry.href}
                  onClick={onNavigate}
                  className="inline-block max-w-full rounded-sm border border-border bg-secondary px-3 py-1.5 text-sm font-semibold text-secondary-foreground break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {entry.linkLabel}
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

type AnnouncementCard = Pick<
  SplashAnnouncement,
  "id" | "name" | "description" | "image" | "href" | "linkLabel"
>;
