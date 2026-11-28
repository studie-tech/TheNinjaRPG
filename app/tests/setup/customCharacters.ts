import { expandLpcDesignVariants, type LpcCatalog } from "@/libs/lpc/catalog";
import { lpcConfigValidator } from "@/validators/lpcAsset";
import source from "./customCharacterCatalog.json";

/** Fixed authoring timelines exercise non-depth imports without depending on bundled artwork. */
export const customCharacterCatalog = source as unknown as LpcCatalog;

/** Inert media references keep colour and recipe regression fixtures independent of atlas releases. */
export const customCharacterConfig = (id: string) => {
  const metadata = customCharacterCatalog.designs[id];
  if (!metadata) throw new Error("Unknown custom character fixture");
  return lpcConfigValidator.parse({
    version: 2,
    ...metadata,
    variants: expandLpcDesignVariants(customCharacterCatalog, id),
    attributions: [
      {
        authors: ["Fixture artist"],
        licenses: ["TNR"],
        chosenLicense: "TNR",
        urls: ["https://example.test/"],
        notes: "",
      },
    ],
  });
};
