import type { Metadata } from "next";
import PublicUserComponent from "@/layout/PublicUser";
import { showUserRank } from "@/libs/profile";
import { isProfileIndexable } from "@/libs/profileIndexing";
import { absoluteUrl, buildMetadata, noindexMetadata } from "@/libs/seo";
import type { findPublicProfileById } from "@/queries/profile";

/**
 * Metadata for both profile routes. Every profile is reachable at /userid/<id> and
 * /username/<name>; Search Console reported these as "Duplicate without user-selected
 * canonical", so both name the username URL that the site links to internally.
 *
 * Unresolvable profiles stay out of the search index. So does a profile the sitemap would
 * not advertise, which the page still renders for anyone who visits: it must not stay
 * indexed on the strength of an old crawl, and it names no canonical, because pairing
 * noindex with a canonical is what Google warns against.
 */
export const publicProfileMetadata = (user: PublicProfile | undefined): Metadata => {
  if (!user) return noindexMetadata("Player Not Found");
  const rank = showUserRank(user);
  const village = user.village?.name;
  const title = `${user.username} - Level ${user.level} ${rank}`;
  if (!isProfileIndexable(user)) return noindexMetadata(title);
  return buildMetadata({
    title,
    description: `${user.username} is a level ${user.level} ${rank}${
      village ? ` of ${village}` : ""
    } in TheNinja-RPG. View their stats, bloodline, badges and battle history.`,
    path: `/username/${encodeURIComponent(user.username)}`,
    image: user.avatar ? absoluteUrl(user.avatar) : undefined,
    type: "article",
  });
};

/** The public profile page of a resolved player or NPC. */
export const PublicProfileView: React.FC<{
  userId: string;
  user: PublicProfile;
}> = ({ userId, user }) => (
  <PublicUserComponent
    userId={userId}
    title={
      user.displayTitle ? `${user.username} [${user.displayTitle}]` : user.username
    }
    subtitle={`Lvl. ${user.level} ${showUserRank(user)}${
      user.village?.name ? ` of ${user.village.name}` : ""
    }`}
    // Same lookup that built the metadata, handed to the client component so the server
    // render carries this player's name, rank and village instead of a placeholder
    // identical to every other profile's.
    initialProfile={{
      username: user.username,
      level: user.level,
      rank: user.rank,
      isOutlaw: user.isOutlaw,
      avatar: user.avatar,
      displayTitle: user.displayTitle,
      villageName: user.village?.name,
    }}
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

type PublicProfile = NonNullable<Awaited<ReturnType<typeof findPublicProfileById>>>;
