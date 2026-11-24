import { notFound } from "next/navigation";
import { PublicProfileView } from "@/layout/PublicProfileView";
import { fetchProfile } from "@/screens/userid/PublicProfileScreen.metadata";

/** Render the shared public profile by user ID with its resolved player or NPC title. */
export async function PublicProfileScreen(props: { params: { userid: string } }) {
  const params = props.params;
  // Matches /username/<name>: an unknown id answers 404 rather than a 200 soft 404.
  const user = await fetchProfile(params.userid);
  if (!user) notFound();
  return <PublicProfileView userId={params.userid} user={user} />;
}
