import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
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
export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const id = params.imageid;
  const image = await drizzleDB.query.conceptImage.findFirst({
    columns: { prompt: true },
    where: and(eq(conceptImage.id, id), indexableConceptArt),
  });
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
  return (
    <ConceptBox_ConceptImage imageid={params.imageid} defaultBackHref="/conceptart" />
  );
}
