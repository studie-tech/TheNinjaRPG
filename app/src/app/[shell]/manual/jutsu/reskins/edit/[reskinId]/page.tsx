"use client";

import { use } from "react";
import { ReskinEditScreen } from "@/screens/manual/jutsu/reskins/edit/ReskinEditScreen";

export default function ReskinEdit(props: { params: Promise<{ reskinId: string }> }) {
  return <ReskinEditScreen params={use(props.params)} />;
}
