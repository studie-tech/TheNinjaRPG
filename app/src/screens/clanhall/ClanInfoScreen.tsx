"use client";

import { ClanProfile } from "@/layout/Clan";
import Loader from "@/layout/Loader";
import { useRequireInVillage } from "@/utils/UserContext";

/** Render the clanhall screen independently of its route adapter. */
export function ClanInfoScreen(props: { params: { clanid: string } }) {
  const params = props.params;
  // Get ID
  const clanId = params.clanid;

  // Must be in allied village
  const { userData, access } = useRequireInVillage("/clanhall");

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Clan Hall" />;

  // Render
  return <ClanProfile defaultBackHref="/clanhall" clanId={clanId} />;
}
