"use client";

import { use } from "react";
import { ActivityStreakEditScreen } from "@/screens/manual/activityStreak/edit/ActivityStreakEditScreen";

export default function ActivityStreakEditPage(props: {
  params: Promise<{ configid: string }>;
}) {
  return <ActivityStreakEditScreen params={use(props.params)} />;
}
