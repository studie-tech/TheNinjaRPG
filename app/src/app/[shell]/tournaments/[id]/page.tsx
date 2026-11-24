import { TournamentScreen } from "@/screens/tournaments/TournamentScreen";

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <TournamentScreen params={await params} />;
}
