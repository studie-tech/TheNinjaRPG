import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { cache } from "react";
import { userData } from "@/drizzle/schema";
import PublicUserComponent from "@/layout/PublicUser";
import { showUserRank } from "@/libs/profile";
import { buildMetadata, noindexMetadata } from "@/libs/seo";
import { drizzleDB } from "@/server/db";

// Cached so generateMetadata and the page render share a single lookup rather than
// each issuing their own query for the same profile.
const fetchProfile = cache(async (username: string) => {
  return await drizzleDB.query.userData.findFirst({
    columns: {
      userId: true,
      username: true,
      level: true,
      rank: true,
      isOutlaw: true,
      avatar: true,
    },
    with: { village: { columns: { name: true } } },
    where: eq(userData.username, decodeURIComponent(username)),
  });
});

export async function generateMetadata(props: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const user = await fetchProfile(params.username);
  // Google was classifying unresolvable profiles as soft 404s; keep those out of the index.
  if (!user) return noindexMetadata("Player Not Found");
  const rank = showUserRank(user);
  const village = user.village?.name;
  return buildMetadata({
    title: `${user.username} - Level ${user.level} ${rank}`,
    description: `${user.username} is a level ${user.level} ${rank}${
      village ? ` of ${village}` : ""
    } in TheNinja-RPG. View their stats, bloodline, badges and battle history.`,
    path: `/username/${encodeURIComponent(user.username)}`,
    image: user.avatar ?? undefined,
    type: "article",
  });
}

export default async function PublicProfile(props: {
  params: Promise<{ username: string }>;
}) {
  const params = await props.params;
  const user = await fetchProfile(params.username);
  return (
    <PublicUserComponent
      userId={user?.userId || params.username}
      title="Users"
      defaultBackHref="/users"
      showRecruited
      showStudents
      showBadges
      showNindo
      showReports
      showTransactions
      showActionLogs
      showTrainingLogs
      showCombatLogs
      showMarriages
      showHistoricalIps
      showActivityEvents
      showBloodlineHistory
    />
  );
}
