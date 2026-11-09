import type { Metadata } from "next";
import { cache } from "react";
import { absoluteUrl, noindexMetadata, SITE_NAME } from "@/libs/seo";
import { findIndexableConceptImageMetadata } from "@/queries/conceptart";
import { drizzleDB } from "@/server/db";
import { truncateString } from "@/utils/string";
import ConceptBox_ConceptImage from "./conceptimage";

type Props = { params: Promise<{ imageid: string }> };

/**
 * The card is the generated one from opengraph-image.tsx in this folder, named by its
 * public path. Left to Next, the tag would carry the path the page was rendered under,
 * which is the internal shell variant rather than the URL a crawler is meant to fetch.
 */
const cardFor = (id: string) => ({
  url: absoluteUrl(`/conceptart/${id}/opengraph-image`),
  width: 1200,
  height: 630,
  alt: "TheNinja-RPG Concept Art",
});

// Cached so generateMetadata and the page render share a single lookup. The columns
// beyond `prompt` are what the page hands the client component to render before its own
// query resolves, so each concept-art URL's HTML carries its own art rather than an
// identical spinner.
const fetchArt = cache(async (id: string) => {
  return await findIndexableConceptImageMetadata(drizzleDB, id);
});

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const id = params.imageid;
  const image = await fetchArt(id);
  if (!image) {
    // Also the page a user watches their own generation on, so it keeps its card.
    return {
      ...noindexMetadata("Concept Art Not Found"),
      openGraph: { images: [cardFor(id)] },
    };
  }
  // Prompts run up to 5000 characters, so trim to something that fits a search result.
  const prompt = image.prompt.trim().replace(/\s+/g, " ");
  const shortPrompt = truncateString(prompt, 70);
  const url = absoluteUrl(`/conceptart/${id}`);
  const description = `AI generated ${SITE_NAME} concept art: ${truncateString(prompt, 140)}`;
  return {
    title: `Concept Art: ${shortPrompt}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `Concept Art: ${shortPrompt}`,
      description,
      url,
      siteName: SITE_NAME,
      images: [cardFor(id)],
      locale: "en_US",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `Concept Art: ${shortPrompt}`,
      description,
      images: [cardFor(id)],
    },
  };
}

export default async function ConceptArtImage(props: Props) {
  const params = await props.params;
  // Deliberately not notFound() when this misses, unlike the forum and profile routes:
  // indexableConceptArt also excludes images that are still generating, and the client
  // query has no such filter, so 404ing here would break the page a user watches their
  // own generation on. A miss renders without a seed and the client query shows its loader.
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
