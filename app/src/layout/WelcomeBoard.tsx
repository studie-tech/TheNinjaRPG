"use client";

import {
  ArrowUpRight,
  Compass,
  Gem,
  Gift,
  Package,
  ScrollText,
  Shield,
  Swords,
} from "lucide-react";
import type { SplashAnnouncement } from "@/drizzle/schema";
import Image from "@/layout/Image";
import Link from "@/layout/Link";

/** Illustrated announcement panels follow editorial priority in a responsive reading order. */
export function WelcomeBoard({
  announcements,
  onNavigate,
}: {
  announcements: readonly AnnouncementCard[];
  onNavigate?: () => void;
}) {
  return (
    <div className="splash-board">
      <div className="splash-stories">
        {announcements.map((entry, index) => {
          const Icon = announcementIcon(entry.href);
          return (
            <article
              key={entry.id}
              className={`splash-story ${index === 0 ? "splash-story-featured" : ""}`}
            >
              <h3 className="splash-story-heading">
                <span className="splash-story-seal" aria-hidden="true">
                  <Icon />
                </span>
                <span>{entry.name}</span>
              </h3>
              <div
                className={`splash-story-body ${entry.image ? "" : "splash-story-without-art"}`}
              >
                <div className="splash-story-copy">
                  <p>{entry.description}</p>
                  <Link
                    href={entry.href}
                    onClick={onNavigate}
                    className="splash-story-link"
                  >
                    {entry.linkLabel}
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </div>
                {entry.image && (
                  <div className="splash-story-art">
                    <Image
                      src={entry.image}
                      alt=""
                      width={index === 0 ? 512 : 320}
                      height={512}
                      sizes="(max-width: 600px) 36vw, 320px"
                      loading={index < 2 ? "eager" : "lazy"}
                    />
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** Familiar destination symbols distinguish announcements without requiring authored icon metadata. */
function announcementIcon(href: string) {
  const path = href.split(/[?#]/)[0];
  if (path === "/chakraStorm") return Compass;
  if (path === "/warehouse") return Package;
  if (path === "/travel" || path === "/manual/dungeon") return Swords;
  if (path === "/adminbuilding") return ScrollText;
  if (path === "/points") return Gem;
  if (path === "/towerDefense") return Shield;
  return Gift;
}

type AnnouncementCard = Pick<
  SplashAnnouncement,
  "id" | "name" | "description" | "image" | "href" | "linkLabel"
>;
