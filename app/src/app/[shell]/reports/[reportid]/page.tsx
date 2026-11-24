"use client";

import { use } from "react";
import { ReportScreen } from "@/screens/reports/ReportScreen";

export default function Report(props: { params: Promise<{ reportid: string }> }) {
  return <ReportScreen params={use(props.params)} />;
}
