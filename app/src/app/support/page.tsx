"use client";

import { useState } from "react";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import { parseHtml } from "@/utils/parse";
import Post from "@/layout/Post";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  MessageCircle,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Tag,
  Users,
} from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useInfinitePagination } from "@/libs/pagination";
import { useRequiredUserData } from "@/utils/UserContext";
import type { SupportTicketStatus } from "@/drizzle/constants";
import SupportTicketFiltering, {
  useFiltering as useSupportTicketFiltering,
  getFilter as getSupportTicketFilter,
} from "@/layout/SupportTicketFiltering";
import {
  getStatusColor,
  getPriorityColor,
  getCategoryColor,
  formatTimeAgo,
} from "@/libs/support";
import { getStatusIcon } from "@/libs/menus";

export default function SupportPage() {
  // State
  const { data: userData } = useRequiredUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  // Support ticket filtering state (replacing legacy filters)
  const filterState = useSupportTicketFiltering();

  // Determine if user is staff
  const isStaff = userData?.role && userData?.role !== "USER";

  // Query for tickets
  const { data, isFetching, fetchNextPage, hasNextPage } =
    api.support.getTickets.useInfiniteQuery(
      {
        ...getSupportTicketFilter(filterState),
        limit: 20,
        // Replace CURRENT_USER placeholder with actual userId
        createdByUserId:
          getSupportTicketFilter(filterState).createdByUserId === "CURRENT_USER"
            ? userData?.userId
            : getSupportTicketFilter(filterState).createdByUserId,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        placeholderData: (previousData) => previousData,
        enabled: userData !== undefined,
      },
    );

  const allTickets =
    data?.pages
      .map((page) => page.data)
      .flat()
      .filter((ticket) => ticket?.createdBy) || [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Query for statistics (staff only)
  const { data: statistics } = api.support.getStatistics.useQuery(
    {},
    { enabled: !!isStaff },
  );

  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <ContentBox
        title="Support Center"
        subtitle={isStaff ? "Staff Dashboard" : "Get help with your questions"}
        topRightContent={
          <div className="flex items-center gap-2">
            <SupportTicketFiltering state={filterState} />
            <Link href="/support/create">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New
              </Button>
            </Link>
          </div>
        }
      >
        {/* Statistics Cards (Staff Only) */}
        {isStaff && statistics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Total</CardTitle>
              </CardHeader>
              <CardContent className="pb-0">
                <div className="text-xl font-bold ">{statistics.totalTickets}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Open </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="text-xl font-bold  text-orange-600">
                  {statistics.openTickets}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Resolved</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="text-xl font-bold  text-green-600">
                  {statistics.resolvedTickets}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-0 pt-2">
                <CardTitle className="text-sm font-medium">Avg. Response</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="text-xl font-bold ">
                  ~{statistics.averageResponseTime}mins
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tickets List */}
        <div className="space-y-4">
          {isFetching ? (
            <Loader explanation="Loading tickets..." />
          ) : (
            <>
              {allTickets.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <AlertCircle className="mx-auto h-12 w-12 mb-4" />
                  <p>No tickets found</p>
                </div>
              )}

              {allTickets.map((ticket, i) => (
                <div key={ticket?.id || `ticket-placeholder-${i}`}>
                  {ticket && (
                    <div ref={i === allTickets.length - 1 ? setLastElement : null}>
                      <Post
                        title={ticket.title}
                        hover_effect={true}
                        user={ticket.createdBy}
                        href={`/support/${ticket.id}`}
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-sm text-foreground-muted">
                            <span>by {ticket.createdBy.username}</span>
                            <Separator orientation="vertical" className="h-4" />
                            <span>{formatTimeAgo(ticket.createdAt)}</span>
                            {ticket.assignedTo && (
                              <>
                                <Separator orientation="vertical" className="h-4" />
                                <span>assigned to {ticket.assignedTo.username}</span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={getStatusColor(ticket.status)}>
                              {getStatusIcon(ticket.status)}
                              <span className="ml-1">
                                {ticket.status.replace("_", " ")}
                              </span>
                            </Badge>
                            <Badge className={getCategoryColor(ticket.category)}>
                              {ticket.category.replace("_", " ")}
                            </Badge>
                            <Badge className={getPriorityColor(ticket.priority)}>
                              {ticket.priority}
                            </Badge>
                            {ticket.isPublic && (
                              <Badge variant="outline">
                                <Users className="h-3 w-3 mr-1" />
                                Public
                              </Badge>
                            )}
                          </div>

                          <div className="text-sm text-foreground line-clamp-3 border p-2 rounded-md">
                            {parseHtml(ticket.description)}
                          </div>

                          {ticket.tags && ticket.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <Tag className="h-3 w-3 text-foreground" />
                              {ticket.tags.map((tag, index) => (
                                <Badge
                                  key={index}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </Post>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </ContentBox>
    </div>
  );
}
