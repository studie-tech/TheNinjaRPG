"use client";

import { use } from "react";
import { ManualAisEditScreen } from "@/screens/manual/ai/edit/ManualAisEditScreen";

export default function ManualAisEdit(props: { params: Promise<{ aiid: string }> }) {
  return <ManualAisEditScreen params={use(props.params)} />;
}
