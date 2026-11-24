"use client";

import { use } from "react";
import { BadgeEditScreen } from "@/screens/manual/badge/edit/BadgeEditScreen";

export default function BadgeEdit(props: { params: Promise<{ badgeid: string }> }) {
  return <BadgeEditScreen params={use(props.params)} />;
}
