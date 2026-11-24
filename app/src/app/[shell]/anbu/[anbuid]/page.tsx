"use client";

import { use } from "react";
import { ANBUDetailsScreen } from "@/screens/anbu/ANBUDetailsScreen";

export default function ANBUDetails(props: { params: Promise<{ anbuid: string }> }) {
  return <ANBUDetailsScreen params={use(props.params)} />;
}
