import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { userData } from "@/drizzle/schema";
import PublicUserComponent from "@/layout/PublicUser";
import { showUserRank } from "@/libs/profile";
import { buildMetadata, noindexMetadata } from "@/libs/seo";
import { drizzleDB } from "@/server/db";

/**
 * Every profile is reachable both here and at /username/<name>. Search Console reported
 * these as "Duplicate without user-selected canonical", so this route points its
 * canonical at the username URL that the site actually links to internally.
 */
export async function generateMetadata(props: {
  params: Promise<{ userid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const user = await drizzleDB.query.userData.findFirst({
    columns: { username: true, level: true, rank: true, isOutlaw: true, avatar: true },
    with: { village: { columns: { name: true } } },
    where: eq(userData.userId, params.userid),
  });
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
  params: Promise<{ userid: string }>;
}) {
  const params = await props.params;
  return (
    <PublicUserComponent
      userId={params.userid}
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
