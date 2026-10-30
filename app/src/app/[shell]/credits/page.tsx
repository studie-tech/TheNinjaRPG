import ContentBox from "@/layout/ContentBox";
import { lpcCatalog } from "@/libs/lpc/catalog";
import credits from "@/libs/lpc/credits.json";
import { buildMetadata } from "@/libs/seo";

export const metadata = buildMetadata({
  title: "Artwork credits",
  description:
    "Artists, source artwork and licences for TheNinja-RPG character sprites.",
  path: "/credits",
});

/** Attribution stays accessible from the game and from native shells. */
export default function ArtworkCredits() {
  const licenses: Record<string, string> = {
    CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
    "OGA-BY": "https://static.opengameart.org/OGA-BY-3.0.txt",
    "CC-BY": "https://creativecommons.org/licenses/by/3.0/",
    "CC-BY-SA": "https://creativecommons.org/licenses/by-sa/3.0/",
  };
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
        <a className="underline" href={lpcCatalog.creditsUrl}>
          Download detailed credits
        </a>
        {" · "}
        <a
          className="underline"
          href={`https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/tree/${lpcCatalog.revision}`}
        >
          Original artwork and source definitions
        </a>
      </p>
      <p className="my-3">
        The sprite files are served without DRM and remain available from this website,
        including when playing in the native app.
      </p>
      <ul className="space-y-4">
        {credits.map((entry, index) => {
          const license = entry.chosenLicense.startsWith("OGA-BY")
            ? "OGA-BY"
            : entry.chosenLicense.startsWith("CC-BY-SA")
              ? "CC-BY-SA"
              : entry.chosenLicense.startsWith("CC0")
                ? "CC0"
                : "CC-BY";
          return (
            <li key={`${entry.profile}-${index}`} className="rounded border p-3">
              <p className="font-semibold">
                {entry.profile}: {entry.authors.join(", ")}
              </p>
              <p>
                <a className="underline" href={licenses[license]}>
                  {entry.chosenLicense}
                </a>
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
