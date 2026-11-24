"use client";

import { use } from "react";
import { BloodlineEditScreen } from "@/screens/manual/bloodline/edit/BloodlineEditScreen";

export default function BloodlineEdit(props: {
  params: Promise<{ bloodlineid: string }>;
}) {
  return <BloodlineEditScreen params={use(props.params)} />;
}
