import { EventTournaments } from "@/layout/EventTournaments";

/** Resolve the event route and render its authenticated staff management view. */
export async function StaffTournamentScreen({ params }: { params: { id: string } }) {
  const { id } = params;
  return <EventTournaments tournamentId={id} staff />;
}
