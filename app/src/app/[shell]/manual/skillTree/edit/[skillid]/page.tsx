"use client";

import { use } from "react";
import { SkillTreeEditScreen } from "@/screens/manual/skillTree/edit/SkillTreeEditScreen";

export default function SkillTreeEdit(props: { params: Promise<{ skillid: string }> }) {
  return <SkillTreeEditScreen params={use(props.params)} />;
}
