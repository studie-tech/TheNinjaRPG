import { PublicProfileScreen } from "@/screens/users/PublicProfileScreen";

export default async function PublicProfile(props: {
  params: Promise<{ userid: string }>;
}) {
  return <PublicProfileScreen params={await props.params} />;
}
