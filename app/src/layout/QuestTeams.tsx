"use client";

import { CheckCircle2, CircleHelp, Ellipsis, Plus, Swords, Users } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_PARTY_PLAYERS } from "@/drizzle/constants";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { PartyRoster } from "@/layout/PartyRoster";
import { TeamChatPanel } from "@/layout/TeamChatPanel";
import { showActionReadinessToast } from "@/libs/actionFeedback";
import { actionStatusMessage, canAttemptAwakeAction } from "@/libs/actionReadiness";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/**
 * Manage shared quest progress and roster in quests or on the team page.
 * Compact mode renders a link; chat stays on the dedicated page.
 */
export const QuestTeams = ({
  questId,
  teamEnabled = true,
  maxPlayers = DEFAULT_PARTY_PLAYERS,
  compact = false,
  asAction = false,
}: {
  questId?: string;
  teamEnabled?: boolean;
  maxPlayers?: number;
  compact?: boolean;
  /** Keep optional team setup behind an action in available quest cards. */
  asAction?: boolean;
}) => {
  const {
    data: user,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
    sector: u.sector,
    longitude: u.longitude,
    latitude: u.latitude,
    status: u.status,
    autoWakeUp: u.autoWakeUp,
  }));
  const utils = api.useUtils();
  const [isPublic, setIsPublic] = useState(false);
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [endAction, setEndAction] = useState<"leave" | "disband" | "remove" | null>(
    null,
  );
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const publicId = useId();
  const { data, error, isPending } = api.coop.quest.overview.useQuery(undefined, {
    enabled: !!user && teamEnabled,
    // Shared progress needs frequent updates; team and invitation discovery can poll less often.
    refetchInterval: (query) => (query.state.data?.current ? 5000 : 30000),
  });
  /** Keep rejections beside the controls; successful changes refresh shared and personal progress. */
  const refresh = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    setMessage(result.success ? "" : result.message);
    if (!result.success && (result.actionNotice || result.userRecovery)) {
      showActionReadinessToast(result);
      await updateUser(result, { revision, refetch: false });
    }
    if (result.success) {
      setEndAction(null);
      setUsername("");
      showMutationToast(result);
      await Promise.all([
        utils.coop.quest.overview.invalidate(),
        utils.quests.specificQuests.invalidate(),
        utils.quests.getPendingRewardChoices.invalidate(),
        updateUser(result, { revision }),
      ]);
    }
  };
  /** Mutation and background refresh failures retain controls and show a recoverable message. */
  const onError = (error: { message: string }) => setMessage(error.message);
  const mutationOptions = {
    onMutate: prepareUserUpdate,
    onSuccess: refresh,
    onError,
  };
  const create = api.coop.quest.create.useMutation(mutationOptions);
  const join = api.coop.quest.join.useMutation(mutationOptions);
  const leave = api.coop.quest.leave.useMutation(mutationOptions);
  const invite = api.coop.quest.invite.useMutation(mutationOptions);
  const remove = api.coop.quest.remove.useMutation(mutationOptions);
  const disband = api.coop.quest.disband.useMutation(mutationOptions);
  const start = api.coop.quest.startEncounter.useMutation(mutationOptions);
  const busy =
    remove.isPending ||
    disband.isPending ||
    create.isPending ||
    join.isPending ||
    leave.isPending ||
    invite.isPending ||
    start.isPending;
  const previousTeamVersion = useRef<string | null>(null);
  const teamVersion = data?.current
    ? `${data.current.id}:${data.current.version}`
    : null;
  // Refresh personal progress and receipts when the team changes or disappears.
  useEffect(() => {
    if (questId && data?.current && data.current.questId !== questId) return;
    if (previousTeamVersion.current && previousTeamVersion.current !== teamVersion)
      void Promise.all([
        updateUser(undefined, { revision: undefined }),
        utils.quests.getPendingRewardChoices.invalidate(),
      ]).catch(onError);
    previousTeamVersion.current = teamVersion;
  }, [teamVersion, questId, data?.current?.questId, updateUser, utils]);
  if (!teamEnabled) return null;
  if (!user) return <Loader explanation="Loading quest teams..." />;
  const current = data?.current;
  const capacity = current?.maxPlayers ?? (questId ? maxPlayers : undefined);
  // Compact summaries link to the full team controls and chat.
  if (compact)
    return current || data?.teams.length || error ? (
      <div className="m-3 flex flex-wrap items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm">
        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{current?.name ?? "Quest teams"}</span>
        {current && (
          <Badge variant="outline">
            {current.completed
              ? "Completed"
              : `${current.members.length}/${current.maxPlayers}`}
          </Badge>
        )}
        {error && <span role="alert">{error.message}</span>}
        <Link
          href="/questteams"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {current ? "Team & chat" : "Find a team"}
        </Link>
      </div>
    ) : null;
  if (questId && current && current.questId !== questId) return null;
  const location = current?.encounterLocation;
  const atEncounter = location && isSameTile(user, location);
  const travelHref = location
    ? `/travel?sector=${location.sector}&longitude=${location.longitude}&latitude=${location.latitude}`
    : "/travel";
  const canEncounter = current?.hasEncounter && !current.completed && !current.failed;
  const missingMembers = current?.members.filter(
    (member) =>
      (member.userId === user.userId && current.leaderId === user.userId
        ? !canAttemptAwakeAction(user)
        : member.status !== "AWAKE") ||
      !location ||
      !isSameTile(member, location),
  );
  const isTeamChooser = asAction && !!questId && !current;
  const content = (
    <section
      className={
        isTeamChooser
          ? "space-y-3"
          : questId
            ? "bg-popover text-popover-foreground space-y-3 rounded-lg border p-3"
            : "text-foreground space-y-4 p-3 sm:p-4"
      }
      aria-label="Quest teams"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-base">
            {current?.name ?? (questId ? "Play with a team" : "Find a team")}
          </h3>
          <p className="mt-1 text-sm">
            {current
              ? `${current.members.length}/${current.maxPlayers} members · ${current.isPublic ? "Public" : "Private"} team`
              : capacity
                ? `Share quest progress with up to ${capacity} players.`
                : "Find a team to share quest progress."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="How quest teams work">
                <CircleHelp className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="space-y-2 text-sm">
              <p className="font-semibold">Quest teams</p>
              <p>
                {capacity ? `Up to ${capacity} players` : "Teammates"} share every
                objective, even when joining mid-quest.
              </p>
              <p>
                Each eligible player claims the full reward. Previously completed
                helpers receive no quest rewards.
              </p>
              <p>
                The leader chooses dialog branches. Gather on the same tile for battles.
              </p>
            </PopoverContent>
          </Popover>
          {current && (
            <Popover open={isOptionsOpen} onOpenChange={setIsOptionsOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Team options"
                  hoverText="Team options"
                >
                  <Ellipsis className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 space-y-1 p-2">
                {(
                  [
                    "leave",
                    ...(current.leaderId === user.userId ? ["disband"] : []),
                  ] as ("leave" | "disband")[]
                ).map((action) => (
                  <Button
                    key={action}
                    className="w-full justify-start"
                    variant="ghost"
                    disabled={busy || !!current.battleId}
                    onClick={() => {
                      setIsOptionsOpen(false);
                      setMessage("");
                      setEndAction(action);
                    }}
                  >
                    {action === "leave" ? "Leave Team" : "Disband Team"}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
      {isPending && <p>Loading quest teams...</p>}
      {(message || error) && !endAction && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          {message || error?.message}
          {(message || error?.message) === actionStatusMessage("HOSPITALIZED") && (
            <>
              {" "}
              <Link
                href="/hospital"
                className="font-medium underline underline-offset-4"
              >
                Go to hospital
              </Link>
            </>
          )}
        </p>
      )}
      {!current && questId && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label
            htmlFor={publicId}
            className="flex min-h-[44px] items-center gap-2 text-sm sm:min-h-9"
          >
            <Switch id={publicId} checked={isPublic} onCheckedChange={setIsPublic} />
            Public team
          </label>
          <Button
            className="min-h-[44px] sm:min-h-9"
            disabled={busy || isPending}
            onClick={() => create.mutate({ questId, isPublic })}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            {create.isPending ? "Forming..." : "Form Quest Team"}
          </Button>
        </div>
      )}
      {current && (
        <div className="space-y-4">
          <PartyRoster
            members={current.members.map((member) => ({
              ...member,
              details:
                member.status !== "AWAKE"
                  ? capitalizeFirstLetter(member.status.toLowerCase())
                  : isSameTile(member, user)
                    ? "At your location"
                    : `Sector ${member.sector} · ${member.longitude}, ${member.latitude}`,
            }))}
            leaderId={current.leaderId}
            viewerId={user.userId}
            capacity={current.maxPlayers}
            disabled={busy || !!current.battleId}
            onRemove={(userId) => {
              setRemoveUserId(userId);
              setMessage("");
              setEndAction("remove");
            }}
          />
          {current.completed && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
            >
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
              Quest complete
              <Button asChild size="sm" className="ml-auto">
                <Link href="/profile?tab=dashboard#progress-heading">Open Logbook</Link>
              </Button>
            </div>
          )}
          {current.failed && (
            <p role="status" className="text-sm">
              The team failed this quest. Leave the team to start another attempt.
            </p>
          )}
          {canEncounter && !current.battleId && (
            <div
              className="space-y-2 rounded-lg border bg-background/50 p-3 text-sm"
              role="status"
            >
              <p className="font-semibold">Gather for the team encounter</p>
              <p>
                {location
                  ? `Sector ${location.sector} · ${location.longitude}, ${location.latitude}`
                  : current.encounterAtNpc
                    ? "Meet at the quest objective's NPC on the map."
                    : "Explore the map to discover the encounter location."}
              </p>
              <p>
                {missingMembers?.length
                  ? `Waiting for: ${missingMembers.map((member) => member.username).join(", ")}. They must be awake at the encounter location.`
                  : "Ready to attempt the team encounter."}
              </p>
              {!atEncounter && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={travelHref}>Travel to encounter</Link>
                </Button>
              )}
              {current.leaderId !== user.userId && (
                <p>The team leader starts the encounter.</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {current.battleId && (
              <Button asChild>
                <Link href="/combat">
                  <Swords className="mr-2 h-4 w-4" />
                  Open team battle
                </Link>
              </Button>
            )}
            {current.leaderId === user.userId && canEncounter && (
              <Button
                disabled={busy || !!current.battleId}
                onClick={() => start.mutate({ partyId: current.id })}
              >
                <Swords className="mr-2 h-4 w-4" aria-hidden="true" />
                {start.isPending ? "Starting..." : "Start Team Encounter"}
              </Button>
            )}
            {!current.battleId && !current.completed && !current.failed && (
              <Button asChild variant="secondary">
                <Link href="/profile?tab=dashboard#progress-heading">View quest</Link>
              </Button>
            )}
          </div>
          {current.leaderId === user.userId &&
            !current.completed &&
            !current.failed &&
            current.members.length < current.maxPlayers &&
            !current.battleId && (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  invite.mutate({ partyId: current.id, username });
                }}
              >
                <Input
                  aria-label="Player username"
                  placeholder="Player username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <Button disabled={busy || !username.trim()}>Invite</Button>
              </form>
            )}
          {questId ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/questteams">Team & chat</Link>
            </Button>
          ) : (
            <TeamChatPanel conversationId={current.id} title="Quest Team Chat" />
          )}
          <Modal
            title={
              endAction === "remove"
                ? `Remove ${current.members.find((member) => member.userId === removeUserId)?.username ?? "member"}?`
                : endAction === "disband"
                  ? "Disband this team?"
                  : "Leave this team?"
            }
            isOpen={!!endAction}
            setIsOpen={(open) => {
              if (!open) setEndAction(null);
            }}
            proceed_label={
              endAction === "remove"
                ? "Remove Member"
                : endAction === "disband"
                  ? "Disband Team"
                  : "Leave Team"
            }
            isLoading={busy}
            keepOpenOnAccept
            onAccept={() => {
              if (endAction === "remove" && removeUserId)
                remove.mutate({ partyId: current.id, userId: removeUserId });
              else if (endAction === "disband") disband.mutate({ partyId: current.id });
              else leave.mutate({ partyId: current.id });
            }}
          >
            <p>
              {endAction === "remove"
                ? "This member keeps their quest progress and unclaimed rewards, and continues solo. Team chat access ends."
                : endAction === "disband"
                  ? "Everyone keeps their quest progress and continues solo. Team chat closes."
                  : "You keep your quest progress and continue solo. Leadership passes to another member if needed."}
            </p>
            {message && (
              <p role="alert" className="text-destructive">
                {message}
              </p>
            )}
          </Modal>
        </div>
      )}
      {!current &&
        data?.teams
          .filter((team) => !questId || team.questId === questId)
          .map((team) => (
            <div
              key={team.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-popover p-3 text-sm"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">{team.name}</p>
                <p className="text-muted-foreground text-xs">
                  {team.members.map((member) => member.username).join(", ")}
                </p>
              </div>
              {team.invited && <Badge variant="outline">Invited</Badge>}
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {team.members.length}/{team.maxPlayers}
              </span>
              <Button
                size="sm"
                disabled={
                  busy || !!team.battleId || team.members.length >= team.maxPlayers
                }
                onClick={() => join.mutate({ partyId: team.id })}
              >
                {team.invited ? "Accept Invitation" : "Join Team"}
              </Button>
            </div>
          ))}
      {!questId && !current && data?.teams.length === 0 && (
        <div className="space-y-2 text-sm">
          <p>
            No public teams or invitations. Form a team from a team-enabled quest:
            event, story and ANBU quests, or a Battle Pyramid tower.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/adminbuilding">Administration Building</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/battlearena#Battle%20Pyramid">Battle Pyramid</Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
  return isTeamChooser ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-h-[44px] sm:min-h-9">
          <Users className="mr-2 h-4 w-4" aria-hidden="true" />
          Play with a team
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="max-h-[70dvh] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        {content}
      </PopoverContent>
    </Popover>
  ) : (
    content
  );
};

/** Whether two map positions are the same tile of the same sector. */
const isSameTile = (a: MapTile, b: MapTile) =>
  a.sector === b.sector && a.longitude === b.longitude && a.latitude === b.latitude;

type MapTile = Record<"sector" | "longitude" | "latitude", number | undefined>;
