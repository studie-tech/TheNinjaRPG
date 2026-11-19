import { IMG_MANUAL_TOWER_UPGRADES } from "@/drizzle/constants";
import type { SplashAnnouncement } from "@/drizzle/schema";
import { splashEditable } from "@/libs/splash";
import type { SplashInput } from "@/validators/splash";

/** Complete announcement row for publication, review and responsive-layout regressions. */
export const splashEntry = (
  overrides: Partial<SplashAnnouncement> = {},
): SplashAnnouncement => ({
  id: "tower-dispatch",
  topicKey: "tower-defense",
  name: "Defend the village",
  description:
    "Face waves of raiders in Tower Defense. Train in the Guard Hall between runs.",
  image: IMG_MANUAL_TOWER_UPGRADES,
  href: "/towerDefense",
  linkLabel: "Play Tower Defense",
  priority: 0,
  enabled: true,
  startsAt: null,
  endsAt: null,
  createdAt: new Date("2026-11-19T00:00:00Z"),
  updatedAt: new Date("2026-11-19T00:00:00Z"),
  ...overrides,
});

/** Valid editable fields without SQL identity or timestamps. */
export const splashInput = (overrides: Partial<SplashInput> = {}): SplashInput => ({
  ...splashEditable(splashEntry()),
  ...overrides,
});
