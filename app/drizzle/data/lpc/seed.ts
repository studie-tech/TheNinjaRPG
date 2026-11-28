import {
  expandLpcDesignVariants,
  type LpcCatalog,
} from "../../../src/libs/lpc/catalog";
import type { LpcConfig } from "../../../src/validators/lpcAsset";
import { lpcConfigValidator } from "../../../src/validators/lpcAsset";
import source from "./catalog.json";

type SeedCatalog = LpcCatalog & {
  revision: string;
  creditsUrl: string;
  profiles: Record<
    string,
    Omit<LpcConfig, "variants"> & {
      name: string;
      image: string;
      hidden: boolean;
    }
  >;
};

/** Stable bundled design IDs let readiness checks avoid expanding unused artwork. */
export const lpcSeedIds = Object.keys(source.profiles);

/** Expand published atlas indices without changing authored depth, palettes or hand poses. */
export const lpcSeedAssets = (catalog = source as unknown as SeedCatalog) => {
  return Object.entries(catalog.profiles).map(([id, profile]) => {
    const { name, image, hidden, ...metadata } = profile;
    const variants = expandLpcDesignVariants(catalog, id);
    const lpcConfig = lpcConfigValidator.parse({ ...metadata, variants });
    return {
      id,
      name,
      type: "LPC" as const,
      image,
      url: catalog.creditsUrl,
      hidden,
      folder: "Characters",
      licenseDetails: [
        ...new Set(lpcConfig.attributions.map((credit) => credit.chosenLicense)),
      ].join(", "),
      lpcConfig,
    };
  });
};
