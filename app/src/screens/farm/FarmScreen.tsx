"use client";

import Loader from "@/layout/Loader";
import OccupationFarming from "@/layout/OccupationFarming";
import { useRequireInVillage } from "@/utils/UserContext";

/** Render the farm screen independently of its route adapter. */
export function FarmScreen() {
  const { userData, access } = useRequireInVillage("/home");

  if (!userData) return <Loader explanation="Loading farm..." />;
  if (!access) return <Loader explanation="Accessing farm..." />;

  return <OccupationFarming defaultBackHref="/home" />;
}
