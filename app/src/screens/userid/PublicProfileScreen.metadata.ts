import type { Metadata } from "next";
import { cache } from "react";
import { publicProfileMetadata } from "@/layout/PublicProfileView";
import { findPublicProfileById } from "@/queries/profile";
import { drizzleDB } from "@/server/db";

// Cached so generateMetadata and the page render share a single lookup rather than
// each issuing their own query for the same profile.
export const fetchProfile = cache(async (userid: string) => {
  return await findPublicProfileById(drizzleDB, userid);
});

/** Build canonical, indexability-aware metadata from the profile lookup shared with the page. */
export async function generateMetadata(props: {
  params: Promise<{ userid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return publicProfileMetadata(await fetchProfile(params.userid));
}
