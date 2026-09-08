import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cache } from "react";
import { conceptImage } from "@/drizzle/schema";
import { indexableConceptArt } from "@/libs/conceptart";
import { absoluteUrl, noindexMetadata, SITE_NAME } from "@/libs/seo";
import { drizzleDB } from "@/server/db";
import ConceptBox_ConceptImage from "./conceptimage";

type Props = { params: Promise<{ imageid: string }> };

/**
 * Note: openGraph.images is deliberately left unset so Next keeps using the generated
 * card from opengraph-image.tsx in this folder. Setting it here would override that
 * with a link to the HTML page rather than an actual image.
 */
// Cached so generateMetadata and the page render share a single lookup. The columns
// beyond `prompt` are what the page hands the client component to render before its own
// query resolves -- without them the server sent every concept-art URL an identical
// spinner.
const fetchArt = cache(async (id: string) => {
  return await drizzleDB.query.conceptImage.findFirst({
    columns: { prompt: true },
    with: { user: { columns: { username: true } } },
    where: and(eq(conceptImage.id, id), indexableConceptArt),
  });
});

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const id = params.imageid;
  const image = await fetchArt(id);
  if (!image) return noindexMetadata("Concept Art Not Found");
  // Prompts run up to 5000 characters, so trim to something that fits a search result.
  const prompt = image.prompt.trim().replace(/\s+/g, " ");
  const shortPrompt = prompt.length > 70 ? `${prompt.slice(0, 67)}...` : prompt;
  const url = absoluteUrl(`/conceptart/${id}`);
  const description = `AI generated ${SITE_NAME} concept art: ${
    prompt.length > 140 ? `${prompt.slice(0, 137)}...` : prompt
  }`;
  return {
    title: `Concept Art: ${shortPrompt}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `Concept Art: ${shortPrompt}`,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `Concept Art: ${shortPrompt}`,
      description,
    },
  };
}

export default async function ConceptArtImage(props: Props) {
  const params = await props.params;
  // Deliberately not notFound() when this misses, unlike the forum and profile routes:
  // indexableConceptArt also excludes images that are still generating, and the client
  // query has no such filter, so 404ing here would break the page a user watches their
  // own generation on. A miss just means no seed, and the loader stands in as before.
  const image = await fetchArt(params.imageid);
  return (
    <ConceptBox_ConceptImage
      imageid={params.imageid}
      defaultBackHref="/conceptart"
      seed={
        image
          ? { prompt: image.prompt, creator: image.user?.username ?? null }
          : undefined
      }
    />
  );
}
