"use client";

import { SiDiscord } from "@icons-pack/react-simple-icons";
import { Bot, Eraser, Presentation } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { TERR_BOT_ID } from "@/drizzle/constants";
import { usePendingIds } from "@/hooks/usePendingIds";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import ReportFiltering, { getFilter, useFiltering } from "@/layout/ReportFiltering";
import ParsedReportJson from "@/layout/ReportReason";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canViewDiscordLinks, isStaffRole } from "@/utils/permissions";
import { reportCommentColor, reportCommentExplain } from "@/utils/reports";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Reports() {
  // State
  const { data: userData } = useRequiredUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const clearing = usePendingIds();
  const [clearedReportIds, setClearedReportIds] = useState<string[]>([]);
  const clearedReportIdsRef = useRef(new Set<string>());

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
  const { data: discordStatus } = api.discord.getStatus.useQuery(undefined, {
    enabled: !!userData && canViewDiscordLinks(userData.role),
  });
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutation
  const clearReport = api.reports.clear.useMutation({
    onSuccess: async (data, variables) => {
      showMutationToast(data);
      if (!data.success) return;

      // The server has accepted this decision, so suppress the action immediately.
      // Keep this local guard even when refreshing the cache fails: a transient query
      // error must never let staff submit the same moderation decision twice.
      clearedReportIdsRef.current.add(variables.object_id);
      setClearedReportIds((current) => [...current, variables.object_id]);

      await utils.reports.getAll.invalidate();
    },
    onSettled: (_data, _error, variables) => clearing.end(variables.object_id),
  });

  const handleClearAiReport = (reportId: string) => {
    // Other report cards remain independently actionable.
    if (clearedReportIdsRef.current.has(reportId) || !clearing.begin(reportId)) return;
    clearReport.mutate({
      comment: "False positive from AI",
      object_id: reportId,
      banTime: 0,
      banTimeUnit: "minutes",
    });
  };

  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <ContentBox
      title="Reports"
      subtitle={userData.role === "USER" ? "Your reports" : "Overview"}
      topRightContent={
        <div>
          <div className="flex flex-col items-start">
            {isStaffRole(userData.role) && (
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
                {discordStatus?.enabled && canViewDiscordLinks(userData.role) && (
                  <Link href="/reports/discord">
                    <Button
                      id="discord-links"
                      hoverText="Discord Links"
                      aria-label="Discord links"
                    >
                      <SiDiscord className="h-6 w-6" title="" aria-hidden />
                    </Button>
                  </Link>
                )}
                <ReportFiltering state={state} />
              </div>
            )}
          </div>
        </div>
      }
    >
      {isFetching && reports === undefined ? (
        <Loader explanation="Fetching Results..." />
      ) : (
        <div>
          {allReports?.length === 0 && <p>No reports found</p>}
          {allReports?.flatMap((entry, i) => {
            const report = entry.UserReport;
            const reportedUser = entry.reportedUser;
            const isAi =
              "reporterUserId" in report && report.reporterUserId === TERR_BOT_ID;
            const isClearing = clearing.ids.has(report.id);
            const isCleared = clearedReportIds.includes(report.id);
            return (
              reportedUser && (
                <div
                  key={report.id}
                  ref={i === allReports.length - 1 ? setLastElement : null}
                  aria-busy={isClearing}
                >
                  <Link
                    href={`/reports/${report.id}`}
                    aria-disabled={isClearing}
                    tabIndex={isClearing ? -1 : undefined}
                    onClick={(event) => {
                      if (isClearing) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  >
                    <Post
                      title={reportCommentExplain(report.status)}
                      color={reportCommentColor(report.status)}
                      image={
                        <div className="mr-3 basis-2/12 truncate text-center sm:basis-3/12 sm:text-base">
                          <AvatarImage
                            href={reportedUser.avatar}
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
                      {isAi && !isCleared && (
                        <div className="flex flex-row p-3">
                          <div className="grow"></div>
                          <Confirm
                            id={`clear-ai-report-${report.id}`}
                            title="Mark AI report as a false positive?"
                            button={
                              <Button
                                id={`clear-ai-report-${report.id}-trigger`}
                                className="bg-green-600"
                                disabled={isClearing}
                                loading={isClearing}
                                aria-busy={isClearing}
                              >
                                {!isClearing && <Eraser className="mr-2 h-5 w-5" />}
                                {isClearing ? "Clearing" : "False Positive from AI"}
                              </Button>
                            }
                            confirmClassName="bg-green-600 text-white hover:bg-green-700"
                            proceed_label="Clear AI report"
                            proceed_loading_label="Clearing"
                            isLoading={isClearing}
                            keepOpenOnAccept
                            disabled={isClearing}
                            onAccept={() => handleClearAiReport(report.id)}
                          >
                            <p>
                              Clear AI report <b>{report.id}</b> for{" "}
                              <b>{reportedUser.username}</b> as a false positive?
                            </p>
                            <p>
                              This records <b>False positive from AI</b> as the staff
                              decision and removes the report from pending moderation.
                              It does not delete the report.
                            </p>
                          </Confirm>
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
