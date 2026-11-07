import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicProfileView, publicProfileMetadata } from "@/layout/PublicProfileView";
import { findPublicProfileById } from "@/queries/profile";
import { drizzleDB } from "@/server/db";

// Cached so generateMetadata and the page render share a single lookup rather than
// each issuing their own query for the same profile.
const fetchProfile = cache(async (userid: string) => {
  return await findPublicProfileById(drizzleDB, userid);
});

/** Build canonical, indexability-aware metadata from the profile lookup shared with the page. */
export async function generateMetadata(props: {
  params: Promise<{ userid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return publicProfileMetadata(await fetchProfile(params.userid));
}

/** Render the shared public profile by user ID with its resolved player or NPC title. */
export default async function PublicProfile(props: {
  params: Promise<{ userid: string }>;
}) {
  const params = await props.params;
  // Matches /username/<name>: an unknown id answers 404 rather than a 200 soft 404.
  const user = await fetchProfile(params.userid);
  if (!user) notFound();
  return <PublicProfileView userId={params.userid} user={user} />;
}
