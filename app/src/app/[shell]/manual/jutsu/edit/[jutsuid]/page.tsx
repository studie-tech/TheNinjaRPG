"use client";

import { use } from "react";
import { JutsuEditScreen } from "@/screens/manual/jutsu/edit/JutsuEditScreen";

export default function JutsuEdit(props: { params: Promise<{ jutsuid: string }> }) {
  return <JutsuEditScreen params={use(props.params)} />;
}
