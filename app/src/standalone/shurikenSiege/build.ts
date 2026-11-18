import type { RouterOutputs } from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import type { LpcCatalog } from "@/libs/lpc/catalog";

/** The portals a build is made for; each decides on links and on the SDK it talks to. */
export const SHURIKEN_SIEGE_TARGETS = ["web", "plain", "crazygames", "poki"] as const;
export type ShurikenSiegeTarget = (typeof SHURIKEN_SIEGE_TARGETS)[number];

/** What a build is made for, written into its page by the build script. */
export interface ShurikenSiegeBuild {
  target: ShurikenSiegeTarget;
  /** Whether the build may link to TheNinja-RPG; portals that forbid outgoing links say no. */
  links: boolean;
  /** Names the site in back-links, so visits from each portal can be told apart. */
  source: string;
  version: string;
}

/** Game data snapshotted from TheNinja-RPG when the build was made. */
export interface ShurikenSiegeData {
  roster: RouterOutputs["towerDefense"]["getRoster"];
  /** Hit and smoke animations and every sound effect, as GameAsset rows. */
  assets: GameAsset[];
  lpcCatalog: LpcCatalog;
  /** Bundled media files, keyed by the CDN URL they replace. */
  media: Record<string, string>;
}

declare global {
  interface Window {
    __SHURIKEN_SIEGE__?: ShurikenSiegeBuild;
  }
}

/** The build the page was made as; a page opened without one behaves as the web build. */
export const readBuild = (): ShurikenSiegeBuild =>
  window.__SHURIKEN_SIEGE__ ?? {
    target: "web",
    links: true,
    source: "dev",
    version: "dev",
  };

let data: ShurikenSiegeData | null = null;

/** Load the data file shipped beside the page; done once before the game renders. */
export const loadBuildData = async () => {
  const response = await fetch("data.json");
  if (!response.ok) throw new Error(`Game data failed to load: ${response.status}`);
  data = (await response.json()) as ShurikenSiegeData;
  return data;
};

/** The loaded game data; only read after `loadBuildData` resolved. */
export const buildData = () => {
  if (!data) throw new Error("Game data is not loaded yet");
  return data;
};
