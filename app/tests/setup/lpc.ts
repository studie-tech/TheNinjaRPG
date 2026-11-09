import { buildLpcCatalog } from "@/libs/lpc/catalog";
import source from "../../drizzle/data/lpc/catalog.json";
import { lpcSeedAssets } from "../../drizzle/data/lpc/seed";

/** Real imported artwork metadata for offline renderer and editor regression suites. */
export const lpcAssets = lpcSeedAssets();
export const lpcCatalog = {
  ...buildLpcCatalog(lpcAssets),
  revision: source.revision,
  creditsUrl: source.creditsUrl,
};
