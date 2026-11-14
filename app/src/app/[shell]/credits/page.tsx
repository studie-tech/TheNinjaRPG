import { connection } from "next/server";
import ContentBox from "@/layout/ContentBox";
import { groupLpcCreditsByArtist, lpcLicenseUrl } from "@/libs/lpc/attribution";
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
  const credits = groupLpcCreditsByArtist(assets);
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
        {credits.map((group) => (
          <li key={group.authors.join(", ")} className="rounded border p-3">
            <h2 className="font-semibold text-lg">{group.authors.join(", ")}</h2>
            <ul className="mt-2 divide-y">
              {group.assets.map((entry, index) => {
                const licenseUrl = lpcLicenseUrl(entry.chosenLicense);
                return (
                  <li key={`${entry.profile}-${index}`} className="py-2">
                    <p>
                      <span className="font-semibold">{entry.profile}</span>
                      {" · "}
                      {licenseUrl ? (
                        <a className="underline" href={licenseUrl}>
                          {entry.chosenLicense}
                        </a>
                      ) : (
                        entry.chosenLicense
                      )}
                    </p>
                    {entry.notes && (
                      <p className="break-words text-muted-foreground text-sm">
                        {entry.notes}
                      </p>
                    )}
                    {entry.urls.length > 0 && (
                      <ul className="flex flex-wrap gap-x-3 gap-y-1">
                        {entry.urls.map((url, i) => (
                          <li key={`${url}-${i}`}>
                            <a href={url} className="whitespace-nowrap underline">
                              Original source {i + 1}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </ContentBox>
  );
}
