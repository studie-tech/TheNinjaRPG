"use client";

import { use } from "react";
import { GuideEditScreen } from "@/screens/guide/edit/GuideEditScreen";

export default function GuideEdit(props: { params: Promise<{ id: string }> }) {
  return <GuideEditScreen params={use(props.params)} />;
}
