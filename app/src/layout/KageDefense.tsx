"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KAGE_CHALLENGER_DAILY_LIMIT,
  KAGE_CHALLENGER_WEEKLY_LIMIT,
  KAGE_DEFENSE_CHECK_IN_MINUTES,
  KAGE_DEFENSE_GRACE_MINUTES,
  KAGE_DEFENSE_INSTANT_REQUEST_MINUTES,
  KAGE_DEFENSE_MAX_NO_SHOWS,
  KAGE_DEFENSE_MIN_DAYS,
  KAGE_DEFENSE_NOTICE_HOURS,
  KAGE_DEFENSE_SETUP_HOURS,
  KAGE_DEFENSE_SLOT_MINUTES,
  KAGE_DEFENSE_WINDOW_HOURS,
  KAGE_PRESTIGE_COST,
} from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { pushToCombat } from "@/utils/routing";
import { useUserPicker } from "@/utils/search";
import { useRequiredUserInfo } from "@/utils/UserContext";
import { type KageWindow, kageScheduleSchema } from "@/validators/kage";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Public UTC defenses with role-specific scheduling, attendance and optional early-fight consent. */
export const KageDefense = ({ user }: { user: NonNullable<UserWithRelations> }) => {
  const utils = api.useUtils();
  const router = useRouter();
  const { pusher, prepareUserUpdate, updateUser, timeDiff } = useRequiredUserInfo();
  const [draft, setDraft] = useState<KageWindow[] | null>(null);
  const { methods: nomineeForm, user: nominee } = useUserPicker();
  const nomineeId = nominee?.userId;
  const [aiRequested, setAiRequested] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  // Server time, re-read only when a check-in, start or invitation boundary passes.
  const [clientNow, setClientNow] = useState(() => Date.now());
  const now = clientNow - timeDiff;
  const { data, isPending, error, refetch } = api.kage.getDefenses.useQuery(
    { villageId: user.villageId ?? "" },
    { enabled: !!user.villageId, refetchInterval: 15_000 },
  );
  /** Keep action feedback visible and refresh leadership before entering an admitted battle. */
  const onSuccess = async (
    result: UserDeltaResponse & { battleId?: string },
    _variables: unknown,
    revision: number | undefined,
  ) => {
    showMutationToast(result);
    if (result.userRecovery || result.battleId)
      await updateUser(result, { revision, refetch: false });
    setMessage(result);
    if (result.success) {
      setDraft(null);
      await Promise.all([
        utils.kage.getDefenses.invalidate(),
        utils.village.get.invalidate(),
      ]);
      if (result.battleId) {
        pushToCombat(router, result.battleId);
      }
    }
  };
  const onError = (e: { message: string }) =>
    setMessage({ success: false, message: e.message });
  const nominate = api.kage.nominateKage.useMutation({ onSuccess, onError });
  const publish = api.kage.publishSchedule.useMutation({ onSuccess, onError });
  const join = api.kage.joinDefenseQueue.useMutation({ onSuccess, onError });
  const withdraw = api.kage.withdrawDefense.useMutation({ onSuccess, onError });
  const reschedule = api.kage.rescheduleDefense.useMutation({ onSuccess, onError });
  const ai = api.kage.setDefenseAi.useMutation({ onSuccess, onError });
  const checkIn = api.kage.checkInDefense.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess,
    onError,
  });
  const start = api.kage.startDefense.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess,
    onError: (error) => {
      onError(error);
    },
  });
  const requestInstant = api.kage.requestInstantDefense.useMutation({
    onSuccess,
    onError,
  });
  const dismissInstant = api.kage.dismissInstantDefense.useMutation({
    onSuccess,
    onError,
  });
  const pending = [
    nominate,
    publish,
    join,
    withdraw,
    reschedule,
    ai,
    checkIn,
    start,
    requestInstant,
    dismissInstant,
  ].some((m) => m.isPending);
  const hall = data?.hall;
  const isKage = hall?.kageId === user.userId;
  const mine = hall?.queue.find((m) => m.challengerId === user.userId);
  const windows =
    draft ??
    (hall?.schedule?.windows.length
      ? hall.schedule.windows
      : [
          { day: 1, hour: 12 },
          { day: 4, hour: 12 },
        ]);
  const locked = hall?.queue.some((m) =>
    ["SCHEDULED", "STARTING", "BATTLE"].includes(m.status),
  );
  const paused = hall?.schedule?.paused;
  const invitation = hall?.schedule?.instantChallenge;
  // Hide expired consent immediately instead of waiting for the next schedule poll.
  const activeInvitation =
    invitation && new Date(invitation.expiresAt).getTime() > now
      ? invitation
      : undefined;
  useRefreshAt(
    [
      invitation?.expiresAt,
      ...(hall?.queue ?? []).flatMap((m) => {
        const at = m.scheduledAt?.getTime();
        return at === undefined
          ? []
          : [
              at - KAGE_DEFENSE_CHECK_IN_MINUTES * 60_000,
              at,
              at + KAGE_DEFENSE_GRACE_MINUTES * 60_000,
            ];
      }),
    ],
    () => setClientNow(Date.now()),
    timeDiff,
  );
  // New schedule data can already be inside a window that began after the last read.
  useEffect(() => {
    if (data) setClientNow(Date.now());
  }, [data]);
  /** Validate with the server's schema so publication failures preserve an editable draft. */
  const publishSchedule = () => {
    const parsed = kageScheduleSchema.safeParse({
      villageId: user.villageId ?? "",
      windows,
    });
    if (!parsed.success) {
      setMessage({
        success: false,
        message: parsed.error.issues.map((issue) => issue.message).join(". "),
      });
      return;
    }
    publish.mutate(parsed.data);
  };

  return (
    <ContentBox
      title="Kage Defense"
      subtitle="Public schedule & challenge queue"
      initialBreak
    >
      {isPending ? (
        <Loader explanation="Loading defense schedule" />
      ) : error ? (
        <div role="alert">
          <p>{error.message}</p>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : !hall ? (
        <p>Defense scheduling is available in villages.</p>
      ) : (
        <div className="space-y-5">
          {message && (
            <p
              role="status"
              className={message.success ? "text-green-600" : "text-red-500"}
            >
              {message.message}
            </p>
          )}
          {paused && (
            <p className="rounded border border-amber-500 bg-amber-500/10 p-3 font-semibold">
              Paused for village war. Queue priority is retained. Matches receive new
              times after the war.
            </p>
          )}
          <div className="rounded-lg border p-3">
            <p className="font-semibold">Defense windows · UTC game time</p>
            {hall.schedule?.publishedAt ? (
              <ul className="mt-2 space-y-1">
                {hall.schedule.windows.map((w) => (
                  <li key={w.day}>
                    {days[w.day]} · {hour(w.hour)}–
                    {hour(w.hour + KAGE_DEFENSE_WINDOW_HOURS)} UTC
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2">
                The Kage must publish a schedule by {utc(hall.setupDeadline)}.{" "}
                <Countdown targetDate={hall.setupDeadline} timeDiff={timeDiff} />{" "}
                Otherwise the title passes to an eligible elder or is left vacant. The
                deadline is paused during village wars, and at least{" "}
                {KAGE_DEFENSE_SETUP_HOURS} hours remain after a war ends.
              </p>
            )}
            <p className="mt-2 text-muted-foreground text-sm">
              {hall.queue.length} in queue ·{" "}
              {hall.queue.filter((m) => m.scheduledAt).length} assigned ·{" "}
              {hall.schedule?.windows.length
                ? (hall.schedule.windows.length * KAGE_DEFENSE_WINDOW_HOURS * 60) /
                  KAGE_DEFENSE_SLOT_MINUTES
                : 0}{" "}
              match slots per week.
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              Attendance strikes this tenure: {hall.schedule?.missedStarts ?? 0}/
              {KAGE_DEFENSE_MAX_NO_SHOWS}.
            </p>
            {isKage && locked && (
              <p className="mt-2 text-muted-foreground text-sm">
                Assigned matches lock the schedule. Use a match’s one-time reschedule
                action to move it while preserving queue order.
              </p>
            )}
          </div>
          {isKage && !locked && (
            <KageScheduleEditor
              windows={windows}
              pending={pending}
              setDraft={setDraft}
              onPublish={publishSchedule}
            />
          )}
          {hall.kageId && hall.schedule?.predecessor && (
            <p className="rounded border p-3 text-sm">
              {hall.schedule.predecessor.removedUsername} was removed as Kage on{" "}
              {utc(new Date(hall.schedule.predecessor.removedAt))}{" "}
              {hall.schedule.predecessor.reason.replace(/^Kage removed /, "")}.
            </p>
          )}
          {!hall.kageId && hall.schedule?.vacancy && (
            <div className="space-y-2 rounded border p-3">
              <p>{hall.schedule.vacancy.reason}. Queue priority is retained.</p>
              {user.rank === "ELDER" && (
                <>
                  <UserSearchSelect
                    useFormMethods={nomineeForm}
                    showYourself
                    showAi={false}
                    maxUsers={1}
                    label="Search eligible villager or elder"
                  />
                  <Button
                    disabled={pending || !nomineeId}
                    onClick={() =>
                      nominate.mutate({
                        villageId: user.villageId ?? "",
                        userId: nomineeId ?? "",
                      })
                    }
                  >
                    Nominate and appoint successor
                  </Button>
                </>
              )}
            </div>
          )}
          {!isKage && !mine && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="font-semibold">Compete for the title</p>
              <p>
                {data?.eligibility ?? "You meet the requirements to join the queue."}
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="request-defense-ai"
                  checked={aiRequested}
                  disabled={pending}
                  onCheckedChange={(value) => setAiRequested(value === true)}
                />
                <Label htmlFor="request-defense-ai">
                  Request AI vs AI (requires Kage agreement)
                </Label>
              </div>
              <Button
                disabled={pending || !!data?.eligibility || !hall.kageId}
                onClick={() =>
                  join.mutate({ villageId: user.villageId ?? "", aiRequested })
                }
              >
                Join defense queue
              </Button>
            </div>
          )}
          {mine && (
            <p className="rounded border bg-muted/40 p-3 font-semibold">
              Your queue position: #{hall.queue.indexOf(mine) + 1}.{" "}
              {mine.scheduledAt
                ? `Estimated match: ${utc(mine.scheduledAt)}`
                : paused
                  ? "Waiting for the war to end."
                  : "Waiting for published defense times."}
            </p>
          )}
          <div className="space-y-3">
            <p className="font-semibold">Public queue</p>
            {!hall.queue.length && (
              <p className="text-muted-foreground">No challengers waiting.</p>
            )}
            {hall.queue.map((m, i) => {
              const participant = isKage || m.challengerId === user.userId;
              const at = m.scheduledAt?.getTime();
              const ready =
                !!at &&
                now >= at - KAGE_DEFENSE_CHECK_IN_MINUTES * 60_000 &&
                now <= at + KAGE_DEFENSE_GRACE_MINUTES * 60_000 &&
                !paused &&
                !m.hospitalDeferred;
              const invited =
                activeInvitation?.matchId === m.id ? activeInvitation : undefined;
              return (
                <div key={m.id} className="space-y-2 rounded-lg border p-3">
                  <p className="font-semibold">
                    #{i + 1} ·{" "}
                    <Link href={`/userid/${m.challengerId}`}>{m.username}</Link>
                  </p>
                  <p>
                    {m.status === "BATTLE"
                      ? "Battle in progress"
                      : m.hospitalDeferred
                        ? "Waiting for hospital discharge; a fresh check-in period follows."
                        : m.scheduledAt
                          ? utc(m.scheduledAt)
                          : "Awaiting assignment"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {m.aiRequested && m.aiAccepted
                      ? "Agreed AI vs AI"
                      : m.aiRequested
                        ? "AI requested; awaiting Kage agreement. Manual PvP until accepted."
                        : "Manual PvP"}{" "}
                    ·{" "}
                    {m.checkedInAt
                      ? "Challenger checked in"
                      : "Challenger not checked in"}
                  </p>
                  {participant && invited && !paused && m.status === "SCHEDULED" && (
                    <div
                      className="space-y-2 rounded border border-amber-500 bg-amber-500/10 p-3"
                      role="status"
                    >
                      <p className="font-semibold">
                        {isKage
                          ? "Instant challenge pending"
                          : "Your Kage invites you to fight now"}
                      </p>
                      <p className="text-sm">
                        {invited.ai ? "AI vs AI" : "Manual PvP"} · Expires{" "}
                        {utc(new Date(invited.expiresAt))}. Declining or ignoring this
                        invitation has no penalty. Your scheduled match stays unchanged
                        until accepted.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {!isKage && (
                          <Button
                            disabled={pending}
                            onClick={() =>
                              start.mutate({ id: m.id, instantRequestId: invited.id })
                            }
                          >
                            Accept and fight now
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            dismissInstant.mutate({
                              id: m.id,
                              instantRequestId: invited.id,
                            })
                          }
                        >
                          {isKage ? "Cancel invitation" : "Decline invitation"}
                        </Button>
                      </div>
                    </div>
                  )}
                  {participant && m.status !== "BATTLE" && (
                    <div className="flex flex-wrap gap-2">
                      {m.challengerId === user.userId && (
                        <>
                          <Button
                            disabled={pending || !ready}
                            onClick={() => checkIn.mutate({ id: m.id })}
                          >
                            {m.checkedInAt ? "Confirm check-in" : "Check in"}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => withdraw.mutate({ id: m.id })}
                          >
                            Withdraw
                          </Button>
                          <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              ai.mutate({ id: m.id, consent: !m.aiRequested })
                            }
                          >
                            {m.aiRequested
                              ? "Withdraw AI request"
                              : "Request AI combat"}
                          </Button>
                        </>
                      )}
                      {(isKage ||
                        (hall.kage?.isAi && m.challengerId === user.userId)) && (
                        <Button
                          disabled={
                            pending || !ready || !m.checkedInAt || !at || now < at
                          }
                          onClick={() =>
                            start.mutate({
                              id: m.id,
                              originSocketId: pusher?.connection.socket_id,
                            })
                          }
                        >
                          Start title fight
                        </Button>
                      )}
                      {isKage && m.status === "SCHEDULED" && (
                        <Button
                          variant="outline"
                          disabled={
                            pending ||
                            paused ||
                            m.hospitalDeferred ||
                            !!activeInvitation ||
                            hall.queue.some((entry) =>
                              ["STARTING", "BATTLE"].includes(entry.status),
                            )
                          }
                          onClick={() => requestInstant.mutate({ id: m.id })}
                        >
                          Challenge now
                        </Button>
                      )}
                      {isKage && m.aiRequested && (
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            ai.mutate({ id: m.id, consent: !m.aiAccepted })
                          }
                        >
                          {m.aiAccepted ? "Decline AI combat" : "Agree to AI combat"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={
                          pending || m.rescheduled || paused || !at || now >= at
                        }
                        onClick={() => reschedule.mutate({ id: m.id })}
                      >
                        {m.rescheduled ? "Reschedule used" : "Reschedule once"}
                      </Button>
                    </div>
                  )}
                  {m.status === "BATTLE" && participant && (
                    <Link href="/combat">Open combat</Link>
                  )}
                </div>
              );
            })}
          </div>
          <KageDefenseRules isAiKage={hall.kage?.isAi} />
          {!!hall.history.length && (
            <div className="space-y-2 border-t pt-3">
              <p className="font-semibold">Recent outcomes</p>
              {hall.history.map((m) => (
                <p key={m.id} className="text-sm">
                  {m.resolvedAt && utc(m.resolvedAt)} · {m.outcome}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </ContentBox>
  );
};

/** Kage-only editor for the weekly defense windows; the parent owns the draft and publication. */
const KageScheduleEditor = ({
  windows,
  pending,
  setDraft,
  onPublish,
}: {
  windows: KageWindow[];
  pending: boolean;
  setDraft: (windows: KageWindow[]) => void;
  onPublish: () => void;
}) => {
  const setWindow = (index: number, field: "day" | "hour", value: number) =>
    setDraft(windows.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="font-semibold">Publish defense times</p>
      <p className="text-sm">
        Choose at least {KAGE_DEFENSE_MIN_DAYS} different days. Each window lasts{" "}
        {KAGE_DEFENSE_WINDOW_HOURS} hours. Assigned matches lock the schedule.
      </p>
      {windows.map((w, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-36 flex-1 flex-col gap-1 text-sm">
            <Label htmlFor={`kage-defense-day-${i}`}>Day {i + 1}</Label>
            <Select
              value={String(w.day)}
              disabled={pending}
              onValueChange={(value) => setWindow(i, "day", Number(value))}
            >
              <SelectTrigger
                id={`kage-defense-day-${i}`}
                aria-label={`Defense day ${i + 1}`}
                className="h-10 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-36 flex-1 flex-col gap-1 text-sm">
            <Label htmlFor={`kage-defense-hour-${i}`}>Start time (UTC)</Label>
            <Select
              value={String(w.hour)}
              disabled={pending}
              onValueChange={(value) => setWindow(i, "hour", Number(value))}
            >
              <SelectTrigger
                id={`kage-defense-hour-${i}`}
                aria-label={`Defense start time ${i + 1}`}
                className="h-10 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 25 - KAGE_DEFENSE_WINDOW_HOURS }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {hour(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {windows.length > KAGE_DEFENSE_MIN_DAYS && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDraft(windows.filter((_, index) => index !== i))}
            >
              Remove day {i + 1}
            </Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={onPublish}>
          Publish schedule
        </Button>
        <Button
          variant="outline"
          disabled={pending || windows.length >= days.length}
          onClick={() =>
            setDraft([
              ...windows,
              {
                day: days.findIndex((_, day) => !windows.some((w) => w.day === day)),
                hour: 12,
              },
            ])
          }
        >
          Add day
        </Button>
      </div>
    </div>
  );
};

/** Challenge limits, attendance, instant-fight and prestige rules shown to every viewer. */
const KageDefenseRules = ({ isAiKage }: { isAiKage?: boolean }) => (
  <div className="space-y-2 border-t pt-3 text-muted-foreground text-sm">
    <p>
      Challengers may fight {KAGE_CHALLENGER_DAILY_LIMIT} time per UTC day and{" "}
      {KAGE_CHALLENGER_WEEKLY_LIMIT} times per Monday–Sunday week. New matches have at
      least {KAGE_DEFENSE_NOTICE_HOURS} hours’ notice. You remain free to play while
      queued.
    </p>
    <p>
      Check in {KAGE_DEFENSE_CHECK_IN_MINUTES} minutes early and remain awake.{" "}
      {isAiKage ? "The challenger" : "The Kage"} starts at the appointed time with a{" "}
      {KAGE_DEFENSE_GRACE_MINUTES}
      -minute grace period. Hospital stays defer the match. {KAGE_DEFENSE_MAX_NO_SHOWS}{" "}
      missed attended starts remove the Kage; strikes reset with each tenure. Service
      interruptions and wars cause no attendance penalty.
    </p>
    <p>
      The Kage can invite a scheduled challenger to fight immediately. Invitations
      expire after {KAGE_DEFENSE_INSTANT_REQUEST_MINUTES} minutes without penalty;
      accepting starts the title fight with the usual combat rules and challenge limits.
    </p>
    <p>
      Both fighters begin with full health, chakra and stamina. A losing challenger pays{" "}
      {KAGE_PRESTIGE_COST.toLocaleString()} prestige. Queue withdrawals and ordinary
      offline time have no prestige cost. Each new Kage has {KAGE_DEFENSE_SETUP_HOURS}{" "}
      hours to publish a schedule; leadership changes clear defense times and retain
      challenger priority.
    </p>
  </div>
);

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Render the published UTC hour without applying the viewer's local timezone. */
const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
/** Include the UTC label so appointment dates cannot be mistaken for local time. */
const utc = (date: Date) =>
  `${date.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`;
