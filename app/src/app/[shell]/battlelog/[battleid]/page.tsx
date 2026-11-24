"use client";

import { use } from "react";
import { BattleLogScreen } from "@/screens/battlelog/BattleLogScreen";

export default function BattleLog(props: { params: Promise<{ battleid: string }> }) {
  return <BattleLogScreen params={use(props.params)} />;
}
