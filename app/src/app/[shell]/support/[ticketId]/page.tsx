"use client";

import { use } from "react";
import { TicketDetailScreen } from "@/screens/support/TicketDetailScreen";

export default function TicketDetail(props: { params: Promise<{ ticketId: string }> }) {
  return <TicketDetailScreen params={use(props.params)} />;
}
