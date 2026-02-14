import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import PublicUserComponent from "@/layout/PublicUser";
import { drizzleDB } from "@/server/db";

export default async function PublicProfile(props: {
  params: Promise<{ username: string }>;
}) {
  const params = await props.params;
  const user = await drizzleDB.query.userData.findFirst({
    columns: { userId: true },
    where: eq(userData.username, decodeURIComponent(params.username)),
  });
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
