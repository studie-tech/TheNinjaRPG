/**
 * The small landing-page subset needed by global client UI and the sitemap.
 *
 * Keep this separate from landing.ts: Footer is imported by the client layouts, so
 * importing the full content module there would ship every section and FAQ on every route.
 */
export const LANDING_LINKS = {
  "ninja-game": { path: "/ninja-game", title: "Ninja Game" },
  "browser-rpg": { path: "/browser-rpg", title: "Browser RPG" },
  "anime-ninja-online": {
    path: "/anime-ninja-online",
    title: "Anime Ninja Online",
  },
} as const;

export const LANDING_ROUTES = Object.values(LANDING_LINKS).map((page) => page.path);
