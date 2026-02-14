"use client";

import { AlertCircle, Plus, Tag, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import SupportTicketFiltering, {
  getFilter as getSupportTicketFilter,
  useFiltering as useSupportTicketFiltering,
} from "@/layout/SupportTicketFiltering";
import { getStatusIcon } from "@/libs/menus";
import { useInfinitePagination } from "@/libs/pagination";
import {
  formatTimeAgo,
  getCategoryColor,
  getPriorityColor,
  getStatusColor,
} from "@/libs/support";
import { parseHtml } from "@/utils/parse";
import { useRequiredUserData } from "@/utils/UserContext";

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
    data?.pages.flatMap((page) => page.data).filter((ticket) => ticket?.createdBy) ||
    [];
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
                <Plus className="mr-2 h-4 w-4" />
                New
              </Button>
            </Link>
          </div>
        }
      >
        {/* Statistics Cards (Staff Only) */}
        {isStaff && statistics && (
          <div className="mb-6 grid grid-cols-2 gap-2">
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Total</CardTitle>
              </CardHeader>
              <CardContent className="pb-0">
                <div className="font-bold text-xl">{statistics.totalTickets}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Open </CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="font-bold text-orange-600 text-xl">
                  {statistics.openTickets}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Resolved</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="font-bold text-green-600 text-xl">
                  {statistics.resolvedTickets}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Assigned to Me</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="font-bold text-blue-600 text-xl">
                  {statistics.assignedToCurrentUser}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pt-2 pb-0">
                <CardTitle className="font-medium text-sm">Avg. Response</CardTitle>
              </CardHeader>
              <CardContent className="py-1">
                <div className="font-bold text-xl">
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
                <div className="py-8 text-center text-gray-500">
                  <AlertCircle className="mx-auto mb-4 h-12 w-12" />
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
                        color={
                          ticket.assignedTo?.userId === userData?.userId
                            ? "blue"
                            : "default"
                        }
                        user={ticket.createdBy}
                        href={`/support/${ticket.id}`}
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-foreground-muted text-sm">
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

                          <div className="flex flex-wrap items-center gap-2">
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
                                <Users className="mr-1 h-3 w-3" />
                                Public
                              </Badge>
                            )}
                          </div>

                          <div className="line-clamp-3 rounded-md border p-2 text-foreground text-sm">
                            {parseHtml(ticket.description)}
                          </div>

                          {ticket.tags && ticket.tags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              <Tag className="h-3 w-3 text-foreground" />
                              {ticket.tags.map((tag, i) => (
                                <Badge
                                  key={`${tag}-${i}`}
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
