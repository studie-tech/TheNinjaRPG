import { describe, expect, it } from "bun:test";
import { SPLASH_MAX_VISIBLE } from "@/drizzle/constants";
import {
  isSplashActive,
  nextSplashChangeAt,
  visibleSplashAnnouncements,
} from "@/libs/splash";
import { splashSchema } from "@/validators/splash";
import { splashEntry, splashInput } from "../setup/splash";

describe("individual welcome announcements", () => {
  it("uses inclusive starts, exclusive ends and an independent disable switch", () => {
    const entry = splashEntry({
      startsAt: new Date("2026-11-19T10:00:00Z"),
      endsAt: new Date("2026-11-20T10:00:00Z"),
    });
    expect(isSplashActive(entry, new Date("2026-11-19T09:59:59Z"))).toBe(false);
    expect(isSplashActive(entry, entry.startsAt!)).toBe(true);
    expect(isSplashActive(entry, entry.endsAt!)).toBe(false);
    expect(isSplashActive(splashEntry({ enabled: false }))).toBe(false);
  });
  it("shows the ten highest-priority live entries with stable recency ties", () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      splashEntry({ id: `entry-${i}`, priority: i }),
    );
    entries.push(splashEntry({ id: "disabled", priority: 100, enabled: false }));
    entries.push(
      splashEntry({ id: "future", priority: 100, startsAt: new Date("2030-01-01") }),
    );
    const selected = visibleSplashAnnouncements(entries, new Date("2026-11-19"));
    expect(selected).toHaveLength(SPLASH_MAX_VISIBLE);
    expect(selected.map((entry) => entry.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `entry-${14 - i}`),
    );
    const tie = visibleSplashAnnouncements([
      splashEntry({ id: "older" }),
      splashEntry({ id: "newer", createdAt: new Date("2026-11-20") }),
    ]);
    expect(tie.map((entry) => entry.id)).toEqual(["newer", "older"]);
  });
  it("does not resurrect disabled entries through fallback defaults", () => {
    expect(visibleSplashAnnouncements([])).toEqual([]);
    expect(visibleSplashAnnouncements([splashEntry({ enabled: false })])).toEqual([]);
  });
  it("refreshes for future starts and live ends even outside the visible ten", () => {
    const end = new Date("2026-11-19T10:01:00Z");
    expect(
      nextSplashChangeAt(
        [
          splashEntry({ endsAt: end }),
          splashEntry({ enabled: false, startsAt: new Date("2026-11-19T10:00:30Z") }),
        ],
        new Date("2026-11-19T10:00:00Z"),
      ),
    ).toEqual(end);
  });
  it("accepts an entry and supported uploaded art", () => {
    expect(splashSchema.safeParse(splashInput()).success).toBe(true);
    expect(
      splashSchema.safeParse(splashInput({ image: "https://utfs.io/f/dispatch.webp" }))
        .success,
    ).toBe(true);
  });
  it.each([
    "h",
    "https:",
    "https://",
    "https://example.com/image.png",
    "http://uploadthing.b-cdn.net/image.png",
    "https://uploadthing.b-cdn.net.evil.com/image.png",
  ])("refuses unsupported artwork %s", (image) => {
    expect(splashSchema.safeParse(splashInput({ image })).success).toBe(false);
  });
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"])(
    "refuses an external destination %s",
    (href) => {
      expect(splashSchema.safeParse(splashInput({ href })).success).toBe(false);
    },
  );
  it("rejects an inverted publication window and invalid topic identity", () => {
    expect(
      splashSchema.safeParse(
        splashInput({
          startsAt: "2026-11-20T00:00:00Z",
          endsAt: "2026-11-19T00:00:00Z",
        }),
      ).success,
    ).toBe(false);
    expect(
      splashSchema.safeParse(splashInput({ topicKey: "Some NEW topic!" })).success,
    ).toBe(false);
  });
});
