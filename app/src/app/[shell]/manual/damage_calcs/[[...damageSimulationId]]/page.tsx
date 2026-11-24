"use client";

import { use } from "react";
import { SimulatorScreen } from "@/screens/manual/damage_calcs/SimulatorScreen";

export default function Simulator(props: {
  params: Promise<{ damageSimulationId?: string }>;
}) {
  return <SimulatorScreen params={use(props.params)} />;
}
