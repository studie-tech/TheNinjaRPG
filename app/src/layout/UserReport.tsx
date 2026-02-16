"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Ban,
  Clock,
  EarOff,
  Eraser,
  MessagesSquare,
  Repeat,
  Rocket,
  ShieldAlert,
} from "lucide-react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FederalStatus, TimeUnit, UserRank, UserRole } from "@/drizzle/constants";
import { REPORT_CONTEXT_WINDOW, TERR_BOT_ID, TimeUnits } from "@/drizzle/constants";
import type { UserReport } from "@/drizzle/schema";
import { CommentOnReport } from "@/layout/Comment";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import ParsedReportJson from "@/layout/ReportReason";
import RichInput from "@/layout/RichInput";
import SliderField from "@/layout/SliderField";
import { showMutationToast } from "@/libs/toast";
import type { BaseServerResponse } from "@/server/api/trpc";
import { parseHtml } from "@/utils/parse";
import {
  canBanUsers,
  canClearReport,
  canEscalateBan,
  canModerateReports,
  canPostReportComment,
  canSilenceUsers,
  canTimeoutUsers,
  canWarnUsers,
} from "@/utils/permissions";
import { reportCommentColor, reportCommentExplain } from "@/utils/reports";
import { useRequiredUserData } from "@/utils/UserContext";
import type { ReportCommentSchema } from "@/validators/reports";
import { reportCommentSchema } from "@/validators/reports";

interface UserReportProps {
  report: UserReport & {
    reportedUser: {
      userId: string;
      username: string;
      avatar: string | null;
      rank: UserRank;
      isOutlaw: boolean;
      level: number;
      role: UserRole;
      federalStatus: FederalStatus;
    } | null;
    reporterUser: {
      userId: string;
      username: string;
      avatar: string | null;
      rank: UserRank;
      isOutlaw: boolean;
      level: number;
      role: UserRole;
      federalStatus: FederalStatus;
    } | null;
  };
  initialBreak?: boolean;
  hideHrefBack?: boolean;
}

const DisplayUserReport: React.FC<UserReportProps> = (props) => {
  const report = props.report;

  const { data: userData, timeDiff } = useRequiredUserData();

  const { data: comments } = api.comments.getReportComments.useInfiniteQuery(
    { id: report.id, limit: 100 },
    {
      enabled: report !== undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allComments = comments?.pages.flatMap((page) => page.data);

  // Form handling
  const {
    handleSubmit,
    reset,
    register,
    setValue,
    control,
    formState: { errors },
  } = useForm<ReportCommentSchema>({
    defaultValues: {
      comment: "",
      banTime: 0,
      banTimeUnit: "days",
    },
    resolver: zodResolver(reportCommentSchema),
  });

  const watchedComment = useWatch({ control, name: "comment", defaultValue: "" });
  const watchedLength = useWatch({ control, name: "banTime", defaultValue: 0 });
  const watchedUnit = useWatch({ control, name: "banTimeUnit", defaultValue: "days" });

  // Get utils
  const utils = api.useUtils();

  const onSuccess = async (data: BaseServerResponse) => {
    showMutationToast(data);
    if (data.success) {
      await utils.reports.getAll.invalidate();
      await utils.reports.get.invalidate();
      await utils.comments.getReportComments.invalidate();
      await utils.profile.getUser.invalidate();
      reset();
    }
  };

  const banUser = api.reports.ban.useMutation({ onSuccess });
  const tradebanUser = api.reports.tradeBan.useMutation({ onSuccess });
  const clearReport = api.reports.clear.useMutation({ onSuccess });
  const createComment = api.comments.createReportComment.useMutation({ onSuccess });
  const escalateReport = api.reports.escalate.useMutation({ onSuccess });
  const silenceUser = api.reports.silence.useMutation({ onSuccess });
  const timeoutUser = api.reports.timeout.useMutation({ onSuccess });
  const warnUser = api.reports.warn.useMutation({ onSuccess });

  const isPending =
    banUser.isPending ||
    tradebanUser.isPending ||
    clearReport.isPending ||
    createComment.isPending ||
    escalateReport.isPending ||
    silenceUser.isPending ||
    timeoutUser.isPending ||
    warnUser.isPending;

  const isAi =
    allComments !== undefined &&
    allComments.length === 0 &&
    report &&
    report.reporterUserId === TERR_BOT_ID;

  useEffect(() => {
    if (report) {
      setValue("object_id", report.id);
      if (isAi && watchedComment === "") {
        setValue("comment", report.reason);
      }
    }
  }, [isAi, report, setValue]);

  const handleSubmitComment = handleSubmit(
    (data) => createComment.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitBan = handleSubmit(
    (data) => banUser.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitTradeBan = handleSubmit(
    (data) => tradebanUser.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitSilence = handleSubmit(
    (data) => silenceUser.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitEscalation = handleSubmit(
    (data) => escalateReport.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitClear = handleSubmit(
    (data) => clearReport.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitWarn = handleSubmit(
    (data) => warnUser.mutate(data),
    (errors) => console.error(errors),
  );

  const handleSubmitTimeout = handleSubmit(
    (data) => timeoutUser.mutate({ comment: data.comment, object_id: data.object_id }),
    (errors) => console.error(errors),
  );

  if (!userData || !report) {
    return <Loader explanation="Loading data..." />;
  }

  // Permissions determining look of page
  const canComment = canPostReportComment(report);
  const canEscalate = canEscalateBan(userData, report);
  const canClear = canClearReport(userData, report);
  const canModerate = canModerateReports(userData, report);
  const canBan = canBanUsers(userData);
  const canSilence = canSilenceUsers(userData);
  const canTimeout = canTimeoutUsers(userData);
  const canWarn = canWarnUsers(userData);
  const canWrite = canComment || canEscalate || canClear || canModerate;

  return (
    <>
      <ContentBox
        title="Reports"
        defaultBackHref={props.hideHrefBack ? undefined : "/reports"}
        subtitle="Details about user report"
        initialBreak={props.initialBreak}
      >
        {report.reportedUser && (
          <Post user={report.reportedUser} hover_effect={true}>
            {report.banEnd && (
              <div className="mb-3">
                <b>Ban countdown:</b>{" "}
                <Countdown targetDate={report.banEnd} timeDiff={timeDiff} />
                <hr />
              </div>
            )}
            <ParsedReportJson report={report} viewer={userData} />
            {report.reporterUser?.username && (
              <div>
                <b>Report by</b> {report.reporterUser?.username}
                <br />
              </div>
            )}
            <b>Current status:</b> {report.status}
          </Post>
        )}
      </ContentBox>

      <ContentBox title="Further Input / Chat" initialBreak={true}>
        <form>
          <div className="mb-3">
            {/* Duration slider only for roles that can silence; timeout-only users have no slider (fixed 1h) */}
            {canModerate && canSilence ? (
              <div className="flex flex-row items-end">
                <div className="grow">
                  <SliderField
                    id="banTime"
                    default={0}
                    min={0}
                    max={100}
                    unit={watchedUnit}
                    label={`Select duration in ${watchedUnit}`}
                    register={register}
                    setValue={setValue}
                    watchedValue={watchedLength}
                    error={errors.banTime?.message}
                  />
                </div>
                <Select
                  onValueChange={(e) => setValue("banTimeUnit", e as TimeUnit)}
                  defaultValue={watchedUnit}
                  value={watchedUnit}
                >
                  <SelectTrigger className="m-1 basis-1/4">
                    <SelectValue placeholder={`None`} />
                  </SelectTrigger>
                  <SelectContent>
                    {TimeUnits.map((value, i) => (
                      <SelectItem key={`${value}-${i}`} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : canModerate && canTimeout ? (
              <p className="mb-2 text-sm text-muted-foreground">
                Timeout duration is fixed at 1 hour.
              </p>
            ) : null}

            {canWrite && (
              <RichInput
                id="comment"
                height="200"
                disabled={isPending}
                label="Add information or ask questions"
                error={errors.comment?.message}
                control={control}
              />
            )}
            {canWrite && report.reportedUserId !== userData.userId && (
              <div className="flex flex-row gap-2 p-2">
                {isAi && (
                  <Badge
                    className="bg-slate-500"
                    onClick={() => setValue("comment", "False positive from AI")}
                  >
                    False Positive from AI
                  </Badge>
                )}
                <Badge
                  className="bg-slate-500"
                  onClick={() => setValue("comment", "This report is unjustified")}
                >
                  Unjustified report
                </Badge>
              </div>
            )}
            {isPending && <Loader explanation="Executing action..." />}
            {!isPending && (
              <div className="mt-2 flex flex-row-reverse gap-1">
                {canComment && (
                  <Confirm2
                    title="Confirm Posting Comment"
                    button={
                      <Button id="submit_comment">
                        <MessagesSquare className="mr-2 h-5 w-5" />
                        Comment
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitComment();
                    }}
                  >
                    You are about to post a comment on this report. Please note that
                    this comment can not be edited or deleted afterwards
                  </Confirm2>
                )}
                {!canModerate && canEscalate && (
                  <Confirm2
                    title="Confirm Escalating Report"
                    button={
                      <Button id="submit_comment">
                        <Rocket className="mr-2 h-5 w-5" /> Escalate
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitEscalation();
                    }}
                  >
                    You can chose to escalate this report to admin-level. Please only do
                    this if you feel strongly the decision is wrong, and know that if
                    you do not have good reason for escalating, it may result in further
                    extension of the ban.
                  </Confirm2>
                )}
                {canModerate && canSilence && (
                  <Confirm2
                    title="Confirm Silencing User"
                    button={
                      <Button id="submit_resolve" variant="destructive">
                        <EarOff className="mr-2 h-5 w-5" />
                        Silence
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitSilence();
                    }}
                  >
                    You are about to silence the user. Please note that the comment and
                    decision can not be edited or deleted. You can unsilence the person
                    by posting another comment and &rdquo;Clear&rdquo; the report.
                  </Confirm2>
                )}
                {canModerate && canTimeout && (
                  <Confirm2
                    title="Confirm Timeout (1 hour)"
                    button={
                      <Button id="submit_timeout" variant="destructive">
                        <Clock className="mr-2 h-5 w-5" />
                        Timeout
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitTimeout();
                    }}
                  >
                    You are about to timeout the user for 1 hour. This works like a
                    silence. Please note that the comment and decision can not be edited
                    or deleted. You can unsilence the person by posting another comment
                    and &rdquo;Clear&rdquo; the report.
                  </Confirm2>
                )}
                {canModerate && canBan && (
                  <Confirm2
                    title="Confirm Banning User"
                    button={
                      <Button id="submit_resolve" variant="destructive">
                        <Ban className="mr-2 h-5 w-5" />
                        Ban
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitBan();
                    }}
                  >
                    You are about to ban the user. Please note that the comment and
                    decision can not be edited or deleted. You can unban the person by
                    posting another comment and &rdquo;Clear&rdquo; the report.
                  </Confirm2>
                )}
                {canModerate && canBan && (
                  <Confirm2
                    title="Confirm Trade Ban"
                    button={
                      <Button id="submit_tradeban" variant="destructive">
                        <Repeat className="mr-2 h-5 w-5" />
                        Trade Ban
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitTradeBan();
                    }}
                  >
                    You are about to trade-ban the user. Please note that the comment
                    and decision can not be edited or deleted. You can remove the trade
                    ban by posting another comment and &rdquo;Clear&rdquo; the report.
                  </Confirm2>
                )}
                {canModerate && canWarn && (
                  <Confirm2
                    title="Confirm Warning"
                    button={
                      <Button id="submit_resolve" className="bg-orange-400">
                        <ShieldAlert className="mr-2 h-5 w-5" />
                        Warn
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitWarn();
                    }}
                  >
                    You are about to warn this user. Please note that the comment and
                    decision can not be edited or deleted.
                  </Confirm2>
                )}
                {canModerate && canClear && (
                  <Confirm2
                    title="Confirm Clearing Report"
                    button={
                      <Button id="submit_resolve" className="bg-green-600">
                        <Eraser className="mr-2 h-5 w-5" />
                        Clear
                      </Button>
                    }
                    onAccept={async () => {
                      await handleSubmitClear();
                    }}
                  >
                    You are about to clear the report. Please note that the comment and
                    decision can not be edited or deleted.
                  </Confirm2>
                )}
              </div>
            )}
          </div>
        </form>
        {allComments?.map((comment) => (
          <div key={comment.id}>
            <CommentOnReport
              title={reportCommentExplain(comment.decision)}
              user={comment.user}
              hover_effect={false}
              comment={comment}
              color={reportCommentColor(comment.decision)}
            >
              {parseHtml(comment.content)}
            </CommentOnReport>
          </div>
        ))}
      </ContentBox>
      {report.additionalContext.length > 0 && (
        <ContentBox
          title="Conversation Context"
          subtitle={`Latest ${Math.min(REPORT_CONTEXT_WINDOW, report.additionalContext.length)} messages leading up to report`}
          initialBreak
        >
          {report.additionalContext.map((context) => {
            const createdAt = new Date(context.createdAt);
            return (
              <Post
                key={`context-${context.userId}-${createdAt.getTime()}`}
                user={context}
              >
                {context.content}
                <p className="absolute right-2 bottom-0 text-gray-600 text-xs italic">
                  @{createdAt.toLocaleString()}
                </p>
              </Post>
            );
          })}
        </ContentBox>
      )}
    </>
  );
};

export default DisplayUserReport;
