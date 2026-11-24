import { EventTournaments } from "@/layout/EventTournaments";

/** Resolve the event route and render its player bracket and ready checks. */
export async function TournamentScreen({ params }: { params: { id: string } }) {
  const { id } = params;
  return <EventTournaments tournamentId={id} />;
}
