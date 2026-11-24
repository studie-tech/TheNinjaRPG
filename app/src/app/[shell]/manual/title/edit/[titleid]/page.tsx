"use client";

import { use } from "react";
import { TitleEditScreen } from "@/screens/manual/title/edit/TitleEditScreen";

export default function TitleEdit({
  params,
}: {
  params: Promise<{ titleid: string }>;
}) {
  return <TitleEditScreen params={use(params)} />;
}
