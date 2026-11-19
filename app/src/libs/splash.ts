import { SPLASH_MAX_VISIBLE } from "@/drizzle/constants";
import type { SplashAnnouncement } from "@/drizzle/schema";
import type { SplashInput } from "@/validators/splash";

/** An enabled entry is visible only within its inclusive-start, exclusive-end window. */
export const isSplashActive = (
  entry: Pick<SplashAnnouncement, "enabled" | "startsAt" | "endsAt">,
  now = new Date(),
) =>
  entry.enabled &&
  (!entry.startsAt || entry.startsAt <= now) &&
  (!entry.endsAt || entry.endsAt > now);

/** Choose the most important live entries, keeping ties stable across refreshes. */
export const visibleSplashAnnouncements = (
  entries: SplashAnnouncement[],
  now = new Date(),
) =>
  entries
    .filter((entry) => isSplashActive(entry, now))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, SPLASH_MAX_VISIBLE);

/** Read the next publication boundary even when the scheduled entry is outside the visible ten. */
export const nextSplashChangeAt = (entries: SplashAnnouncement[], now = new Date()) => {
  const times = entries
    .filter((entry) => entry.enabled)
    .flatMap((entry) => [entry.startsAt, entry.endsAt])
    .filter((date): date is Date => !!date && date > now);
  return times.length
    ? new Date(Math.min(...times.map((date) => date.getTime())))
    : null;
};

/** Project SQL columns to the shared staff form and versioned review payload. */
export const splashEditable = (entry: SplashAnnouncement): SplashInput => ({
  topicKey: entry.topicKey,
  name: entry.name,
  description: entry.description,
  image: entry.image,
  href: entry.href,
  linkLabel: entry.linkLabel,
  priority: entry.priority,
  enabled: entry.enabled,
  startsAt: entry.startsAt?.toISOString() ?? null,
  endsAt: entry.endsAt?.toISOString() ?? null,
});
