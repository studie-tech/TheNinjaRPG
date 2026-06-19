"use client";

import Loader from "@/layout/Loader";
import OccupationFarming from "@/layout/OccupationFarming";
import { useRequireInVillage } from "@/utils/UserContext";

export default function FarmPage() {
  const { userData, access } = useRequireInVillage("/home");

  if (!userData) return <Loader explanation="Loading farm..." />;
  if (!access) return <Loader explanation="Accessing farm..." />;

  return <OccupationFarming defaultBackHref="/home" />;
}
