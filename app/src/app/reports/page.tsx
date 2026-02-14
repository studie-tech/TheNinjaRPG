"use client";

import { Bot, Eraser, Presentation } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { TERR_BOT_ID } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import ReportFiltering, { getFilter, useFiltering } from "@/layout/ReportFiltering";
import ParsedReportJson from "@/layout/ReportReason";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { reportCommentColor, reportCommentExplain } from "@/utils/reports";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Reports() {
  // State
  const { data: userData } = useRequiredUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Two-level filtering
  const state = useFiltering();

  // Get utils
  const utils = api.useUtils();

  // Query
  const {
    data: reports,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = api.reports.getAll.useInfiniteQuery(
    {
      ...getFilter(state),
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      enabled: userData !== undefined,
    },
  );
  const allReports = reports?.pages.flatMap((page) => page.data);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutation
  const clearReport = api.reports.clear.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await utils.reports.getAll.invalidate();
    },
  });

  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <ContentBox
      title="Reports"
      subtitle={userData?.role === "USER" ? "Your reports" : "Overview"}
      topRightContent={
        <div>
          <div className="flex flex-col items-start">
            {userData?.role !== "USER" && (
              <div className="flex w-full flex-row items-center gap-1">
                <Link href="/reports/statistics">
                  <Button id="report-statistics" hoverText="Staff Activity Overview">
                    <Presentation className="h-6 w-6" />
                  </Button>
                </Link>
                <Link href="/reports/bot-performance">
                  <Button id="bot-performance" hoverText="Mod Bot Performance">
                    <Bot className="h-6 w-6" />
                  </Button>
                </Link>
                <ReportFiltering state={state} />
              </div>
            )}
          </div>
        </div>
      }
    >
      {isFetching ? (
        <Loader explanation="Fetching Results..." />
      ) : (
        <div>
          {allReports?.length === 0 && <p>No reports found</p>}
          {allReports?.flatMap((entry, i) => {
            const report = entry.UserReport;
            const reportedUser = entry.reportedUser;
            const isAi =
              "reporterUserId" in report && report.reporterUserId === TERR_BOT_ID;
            return (
              reportedUser && (
                <div
                  key={report.id}
                  ref={i === allReports.length - 1 ? setLastElement : null}
                >
                  <Link href={`/reports/${report.id}`}>
                    <Post
                      title={reportCommentExplain(report.status)}
                      color={reportCommentColor(report.status)}
                      image={
                        <div className="... mr-3 basis-2/12 truncate text-center sm:basis-3/12 sm:text-base">
                          <AvatarImage
                            href={reportedUser.avatar}
                            userId={reportedUser.userId}
                            alt={reportedUser.username}
                            size={100}
                          />
                        </div>
                      }
                      hover_effect={true}
                    >
                      {report.banEnd && (
                        <div className="mb-3">
                          <b>Ban countdown:</b> <Countdown targetDate={report.banEnd} />
                          <hr />
                        </div>
                      )}
                      <ParsedReportJson report={report} viewer={userData} />
                      {isAi && (
                        <div className="flex flex-row p-3">
                          <div className="grow"></div>
                          <Button
                            id="submit_resolve"
                            className="bg-green-600"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              clearReport.mutate({
                                comment: "False positive from AI",
                                object_id: report.id,
                                banTime: 0,
                                banTimeUnit: "minutes",
                              });
                            }}
                          >
                            <Eraser className="mr-2 h-5 w-5" />
                            False Positive from AI
                          </Button>
                        </div>
                      )}
                    </Post>
                  </Link>
                </div>
              )
            );
          })}
        </div>
      )}
    </ContentBox>
  );
}
