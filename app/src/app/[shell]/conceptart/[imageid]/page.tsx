import { ConceptArtImageScreen } from "@/screens/conceptart/ConceptArtImageScreen";

type Props = { params: Promise<{ imageid: string }> };

export { generateMetadata } from "@/screens/conceptart/ConceptArtImageScreen.metadata";

export default async function ConceptArtImage(props: Props) {
  return <ConceptArtImageScreen params={await props.params} />;
}
