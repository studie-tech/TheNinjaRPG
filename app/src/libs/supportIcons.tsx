import { AlertCircle, CheckCircle, Clock, MessageSquare, XCircle } from "lucide-react";
import type { SupportTicketStatus } from "@/drizzle/constants";

/** Status icons for tickets */
export const getStatusIcon = (status: SupportTicketStatus) => {
  switch (status) {
    case "OPEN":
      return <AlertCircle className="h-4 w-4" />;
    case "IN_PROGRESS":
      return <Clock className="h-4 w-4" />;
    case "WAITING_FOR_USER":
      return <MessageSquare className="h-4 w-4" />;
    case "WAITING_FOR_STAFF":
      return <MessageSquare className="h-4 w-4" />;
    case "RESOLVED":
      return <CheckCircle className="h-4 w-4" />;
    case "CLOSED":
      return <XCircle className="h-4 w-4" />;
  }
};
