import type { RouterOutputs } from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import type { LpcCatalog } from "@/libs/lpc/catalog";

/** The portals a build is made for; each decides on links and on the SDK it talks to. */
export const SHURIKEN_SIEGE_TARGETS = [
  "web",
  "plain",
  "poki",
  "gamedistribution",
  "youtube",
] as const;
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

/** How long the data file may take before the page asks the player to reload. */
const DATA_TIMEOUT_MS = 45_000;

/** Load the data file shipped beside the page; done once before the game renders. */
export const loadBuildData = async () => {
  const response = await fetch("data.json", {
    signal: AbortSignal.timeout?.(DATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Game data failed to load: ${response.status}`);
  const value: unknown = await response.json();
  if (!isBuildData(value)) throw new Error("Game data is malformed");
  data = value;
  return data;
};

/** The data file's shape as far as the game reads it before rendering. */
const isBuildData = (value: unknown): value is ShurikenSiegeData => {
  if (!value || typeof value !== "object") return false;
  const { roster, assets, lpcCatalog, media } = value as Record<string, unknown>;
  return (
    Array.isArray(roster) &&
    Array.isArray(assets) &&
    !!lpcCatalog &&
    typeof lpcCatalog === "object" &&
    !!media &&
    typeof media === "object" &&
    Object.values(media).every((file) => typeof file === "string")
  );
};

/** The loaded game data; only read after `loadBuildData` resolved. */
export const buildData = () => {
  if (!data) throw new Error("Game data is not loaded yet");
  return data;
};
