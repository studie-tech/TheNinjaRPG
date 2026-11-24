"use client";

import { use } from "react";
import { SageModeEditScreen } from "@/screens/manual/sageMode/edit/SageModeEditScreen";

export default function SageModeEdit(props: {
  params: Promise<{ sagemodeid: string }>;
}) {
  return <SageModeEditScreen params={use(props.params)} />;
}
