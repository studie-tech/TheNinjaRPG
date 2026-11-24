import { PublicProfileScreen } from "@/screens/username/PublicProfileScreen";

export { generateMetadata } from "@/screens/username/PublicProfileScreen.metadata";

export default async function PublicProfile(props: {
  params: Promise<{ username: string }>;
}) {
  return <PublicProfileScreen params={await props.params} />;
}
