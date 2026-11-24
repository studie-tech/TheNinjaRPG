import { fetchArt } from "@/screens/conceptart/ConceptArtImageScreen.metadata";
import ConceptBox_ConceptImage from "@/screens/conceptart/conceptimage";

/** Render the conceptart screen independently of its route adapter. */
export async function ConceptArtImageScreen(props: Props) {
  const params = props.params;
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

type Props = { params: { imageid: string } };
