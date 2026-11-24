"use client";

import { use } from "react";
import { ClanInfoScreen } from "@/screens/clanhall/ClanInfoScreen";

export default function ClanInfo(props: { params: Promise<{ clanid: string }> }) {
  return <ClanInfoScreen params={use(props.params)} />;
}
