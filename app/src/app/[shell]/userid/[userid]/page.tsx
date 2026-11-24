import { PublicProfileScreen } from "@/screens/userid/PublicProfileScreen";

export { generateMetadata } from "@/screens/userid/PublicProfileScreen.metadata";

export default async function PublicProfile(props: {
  params: Promise<{ userid: string }>;
}) {
  return <PublicProfileScreen params={await props.params} />;
}
