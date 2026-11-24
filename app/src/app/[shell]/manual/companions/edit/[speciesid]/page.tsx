"use client";

import { use } from "react";
import { PetSpeciesEditScreen } from "@/screens/manual/companions/edit/PetSpeciesEditScreen";

export default function PetSpeciesEdit(props: {
  params: Promise<{ speciesid: string }>;
}) {
  return <PetSpeciesEditScreen params={use(props.params)} />;
}
