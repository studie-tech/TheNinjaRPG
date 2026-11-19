import { describe, expect, it } from "bun:test";
import { DEFAULT_SPLASH, isSplashActive } from "@/libs/splash";
import { splashSchema } from "@/validators/splash";

describe("welcome board publication", () => {
  it("uses inclusive starts, exclusive ends and a staff disable switch", () => {
    const edition = {
      ...DEFAULT_SPLASH,
      startsAt: "2026-11-19T10:00:00.000Z",
      endsAt: "2026-11-20T10:00:00.000Z",
    };
    expect(isSplashActive(edition, new Date("2026-11-19T09:59:59Z"))).toBe(false);
    expect(isSplashActive(edition, new Date(edition.startsAt))).toBe(true);
    expect(isSplashActive(edition, new Date(edition.endsAt))).toBe(false);
    expect(isSplashActive({ ...DEFAULT_SPLASH, enabled: false })).toBe(false);
  });
  it("accepts the evergreen board and uploaded CDN art", () => {
    expect(splashSchema.safeParse(DEFAULT_SPLASH).success).toBe(true);
    expect(
      splashSchema.safeParse({
        ...DEFAULT_SPLASH,
        image: "https://utfs.io/f/dispatch.webp",
      }).success,
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
    expect(splashSchema.safeParse({ ...DEFAULT_SPLASH, image }).success).toBe(false);
  });
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"])(
    "refuses a destination outside the game: %s",
    (href) => {
      expect(
        splashSchema.safeParse({
          ...DEFAULT_SPLASH,
          cards: [{ ...DEFAULT_SPLASH.cards[0], href }],
        }).success,
      ).toBe(false);
    },
  );
  it("rejects an inverted publication window", () => {
    expect(
      splashSchema.safeParse({
        ...DEFAULT_SPLASH,
        startsAt: "2026-11-20T00:00:00Z",
        endsAt: "2026-11-19T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
