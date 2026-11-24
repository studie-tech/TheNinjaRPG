import { StaffTournamentScreen } from "@/screens/manual/tournaments/StaffTournamentScreen";

export default async function StaffTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <StaffTournamentScreen params={await params} />;
}
