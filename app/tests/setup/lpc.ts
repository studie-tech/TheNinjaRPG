import source from "../../drizzle/data/lpc/catalog.json";
import { lpcSeedAssets } from "../../drizzle/data/lpc/seed";
import { buildLpcCatalog } from "@/libs/lpc/catalog";

/** Real imported artwork metadata for offline renderer and editor regression suites. */
export const lpcAssets = lpcSeedAssets();
export const lpcCatalog = {
  ...buildLpcCatalog(lpcAssets),
  revision: source.revision,
  creditsUrl: source.creditsUrl,
};
