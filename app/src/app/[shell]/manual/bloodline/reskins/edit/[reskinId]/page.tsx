"use client";

import { use } from "react";
import { BloodlineReskinEditScreen } from "@/screens/manual/bloodline/reskins/edit/BloodlineReskinEditScreen";

export default function BloodlineReskinEdit(props: {
  params: Promise<{ reskinId: string }>;
}) {
  return <BloodlineReskinEditScreen params={use(props.params)} />;
}
