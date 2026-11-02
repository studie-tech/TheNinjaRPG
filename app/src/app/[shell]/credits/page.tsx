import { connection } from "next/server";
import ContentBox from "@/layout/ContentBox";
import { lpcLicenseUrl } from "@/libs/lpc/attribution";
import { buildMetadata } from "@/libs/seo";
import { listLpcAssets } from "@/queries/asset";
import { drizzleDB } from "@/server/db";

export const metadata = buildMetadata({
  title: "Artwork credits",
  description:
    "Artists, source artwork and licences for TheNinja-RPG character sprites.",
  path: "/credits",
});

/** Attribution stays accessible from the game and from native shells. */
export default async function ArtworkCredits() {
  await connection();
  const assets = await listLpcAssets(drizzleDB);
  const credits = assets.flatMap((asset) =>
    (asset.lpcConfig?.attributions ?? []).map((entry) => ({
      ...entry,
      profile: asset.name,
    })),
  );
  return (
    <ContentBox title="Artwork credits">
      <p className="my-3">
        Character sprites include artwork from the{" "}
        <a
          className="underline"
          href="https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator"
        >
          Universal LPC collection
        </a>
        . The following artists retain copyright in their work. Our sprite atlases crop,
        repack and recolour that artwork under the listed licences. Supplementary fans,
        throwing stars, jewellery, tattoo and scar details are original TNR artwork.
      </p>
      <p className="my-3">
        The sprite files are served without DRM and remain available from this website,
        including when playing in the native app.
      </p>
      <ul className="space-y-4">
        {credits.map((entry, index) => {
          const licenseUrl = lpcLicenseUrl(entry.chosenLicense);
          return (
            <li key={`${entry.profile}-${index}`} className="rounded border p-3">
              <p className="font-semibold">
                {entry.profile}: {entry.authors.join(", ")}
              </p>
              <p>
                {licenseUrl ? (
                  <a className="underline" href={licenseUrl}>
                    {entry.chosenLicense}
                  </a>
                ) : (
                  entry.chosenLicense
                )}
              </p>
              <p className="text-muted-foreground text-sm break-words">{entry.notes}</p>
              <p>
                {entry.urls.map((url, i) => (
                  <a key={url} href={url} className="mr-3 underline">
                    Original source {i + 1}
                  </a>
                ))}
              </p>
            </li>
          );
        })}
      </ul>
    </ContentBox>
  );
}
