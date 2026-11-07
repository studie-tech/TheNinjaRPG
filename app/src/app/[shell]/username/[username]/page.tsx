import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicProfileView, publicProfileMetadata } from "@/layout/PublicProfileView";
import { findPublicProfileByUsername } from "@/queries/profile";
import { drizzleDB } from "@/server/db";

// Cached so generateMetadata and the page render share a single lookup rather than
// each issuing their own query for the same profile.
const fetchProfile = cache(async (username: string) => {
  return await findPublicProfileByUsername(drizzleDB, username);
});

/** Build canonical, indexability-aware metadata from the profile lookup shared with the page. */
export async function generateMetadata(props: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return publicProfileMetadata(await fetchProfile(params.username));
}

/** Render the shared public profile by username with its resolved player or NPC title. */
export default async function PublicProfile(props: {
  params: Promise<{ username: string }>;
}) {
  const params = await props.params;
  const user = await fetchProfile(params.username);
  // Return a real 404 for unresolvable profiles to avoid indexing a soft-404 page.
  if (!user) notFound();
  return <PublicProfileView userId={user.userId} user={user} />;
}
