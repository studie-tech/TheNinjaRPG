"use client";

import { use } from "react";
import { ManualQuestEditScreen } from "@/screens/manual/quest/edit/ManualQuestEditScreen";

export default function ManualQuestEdit(props: {
  params: Promise<{ questid: string }>;
}) {
  return <ManualQuestEditScreen params={use(props.params)} />;
}
