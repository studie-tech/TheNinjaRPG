"use client";

import { use } from "react";
import { ApplicationDetailScreen } from "@/screens/manual/staff/applications/ApplicationDetailScreen";

export default function Page({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  return <ApplicationDetailScreen params={use(params)} />;
}
