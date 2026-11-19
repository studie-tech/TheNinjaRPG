"use client";

import type { SplashAnnouncement } from "@/drizzle/schema";
import Image from "@/layout/Image";
import Link from "@/layout/Link";

/** Size illustrated announcement columns to their actual container, including review previews. */
export function WelcomeBoard({
  announcements,
  onNavigate,
}: {
  announcements: readonly AnnouncementCard[];
  onNavigate?: () => void;
}) {
  return (
    <div className="@container min-w-0">
      <div className="grid gap-3 @min-[36rem]:grid-cols-2 @min-[64rem]:grid-cols-3">
        {announcements.map((entry) => (
          <article
            key={entry.id}
            className="min-w-0 overflow-hidden rounded-sm border-2 border-[#b9954d] bg-[#fff7df] text-[#2d2236] shadow-sm"
          >
            <h3 className="border-b-2 border-[#b9954d] bg-[#35203f] px-4 py-2 font-serif text-xl font-bold text-[#fff1c6] break-words">
              {entry.name}
            </h3>
            <div className="flex gap-3 p-3">
              {entry.image && (
                <Image
                  src={entry.image}
                  alt=""
                  width={120}
                  height={140}
                  className="h-28 w-20 shrink-0 rounded-sm object-cover"
                />
              )}
              <div className="min-w-0 space-y-3">
                <p className="text-sm leading-relaxed whitespace-pre-line break-words">
                  {entry.description}
                </p>
                <Link
                  href={entry.href}
                  onClick={onNavigate}
                  className="inline-block max-w-full rounded-sm border border-[#67452d] bg-[#f0dc9b] px-3 py-1.5 text-sm font-semibold break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35203f]"
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
