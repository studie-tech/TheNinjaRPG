import type { LpcAttribution } from "@/validators/lpcAsset";

/** Link only recognized licence identifiers; original and custom terms retain their authored text. */
export const lpcLicenseUrl = (license: string): string | undefined => {
  if (/^CC0(?:[ -]1\.0)?$/.test(license))
    return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (/^OGA-BY[ -]3\.0\+?$/.test(license))
    return "https://static.opengameart.org/OGA-BY-3.0.txt";
  const creativeCommons = /^CC-BY(-SA)?[ -](3\.0|4\.0)\+?$/.exec(license);
  if (creativeCommons)
    return `https://creativecommons.org/licenses/${creativeCommons[1] ? "by-sa" : "by"}/${creativeCommons[2]}/`;
  return undefined;
};

/**
 * Credits grouped by artist, so each set of authors is listed once with every sprite asset
 * that uses their work. Each asset keeps its licence, notes and source links; a source URL
 * listed twice in one entry is shown once.
 */
export const groupLpcCreditsByArtist = (
  assets: readonly {
    name: string;
    lpcConfig?: { attributions: LpcAttribution[] } | null;
  }[],
): LpcArtistCredits[] => {
  const groups = new Map<string, LpcArtistCredits>();
  for (const asset of assets) {
    for (const entry of asset.lpcConfig?.attributions ?? []) {
      const key = JSON.stringify(entry.authors);
      const group = groups.get(key) ?? { authors: entry.authors, assets: [] };
      group.assets.push({
        profile: asset.name,
        chosenLicense: entry.chosenLicense,
        notes: entry.notes,
        urls: [...new Set(entry.urls)],
      });
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.authors.join(", ").localeCompare(b.authors.join(", ")),
  );
};

export interface LpcArtistCredits {
  authors: string[];
  assets: { profile: string; chosenLicense: string; notes: string; urls: string[] }[];
}
