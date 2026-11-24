import { notFound } from "next/navigation";
import { PublicProfileView } from "@/layout/PublicProfileView";
import { fetchProfile } from "@/screens/username/PublicProfileScreen.metadata";

/** Render the shared public profile by username with its resolved player or NPC title. */
export async function PublicProfileScreen(props: { params: { username: string } }) {
  const params = props.params;
  const user = await fetchProfile(params.username);
  // Return a real 404 for unresolvable profiles to avoid indexing a soft-404 page.
  if (!user) notFound();
  return <PublicProfileView userId={user.userId} user={user} />;
}
