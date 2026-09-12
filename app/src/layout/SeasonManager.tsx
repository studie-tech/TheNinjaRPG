"use client";

import { format } from "date-fns";
import { Loader2, Pencil, Plus, StopCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getRewardArray } from "@/libs/objectives";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import type { DeleteRankedSeasonSnapshot } from "@/validators/pvpRank";
import SeasonForm from "./SeasonForm";

type DeleteSeasonSubmission = {
  requestId: string;
  target: DeleteRankedSeasonSnapshot;
};

type EndSeasonSubmission = DeleteSeasonSubmission;

const copyDeleteSeasonTarget = (
  season: DeleteRankedSeasonSnapshot,
): DeleteRankedSeasonSnapshot =>
  Object.freeze({
    ...season,
    startDate: new Date(season.startDate),
    endDate: new Date(season.endDate),
    createdAt: new Date(season.createdAt),
    updatedAt: new Date(season.updatedAt),
    rewards: structuredClone(season.rewards),
  });

const canonicalDeleteValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalDeleteValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalDeleteValue(entry)]),
    );
  }
  return value;
};

const deleteSeasonTargetsMatch = (
  left: DeleteRankedSeasonSnapshot,
  right: DeleteRankedSeasonSnapshot,
) =>
  left.id === right.id &&
  left.name === right.name &&
  left.description === right.description &&
  left.startDate.getTime() === right.startDate.getTime() &&
  left.endDate.getTime() === right.endDate.getTime() &&
  left.ended === right.ended &&
  left.paused === right.paused &&
  left.createdAt.getTime() === right.createdAt.getTime() &&
  left.updatedAt.getTime() === right.updatedAt.getTime() &&
  JSON.stringify(canonicalDeleteValue(left.rewards)) ===
    JSON.stringify(canonicalDeleteValue(right.rewards));

export function SeasonManager() {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreatePending, setIsCreatePending] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isEditPending, setIsEditPending] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [isEndDialogOpen, setIsEndDialogOpen] = useState(false);
  const [isEndPending, setIsEndPending] = useState(false);
  const [endTarget, setEndTarget] = useState<DeleteRankedSeasonSnapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteRankedSeasonSnapshot | null>(
    null,
  );
  const endInFlightRef = useRef<EndSeasonSubmission | null>(null);
  const endRetryRef = useRef<EndSeasonSubmission | null>(null);
  const deleteInFlightRef = useRef<DeleteSeasonSubmission | null>(null);
  const deleteRetryRef = useRef<DeleteSeasonSubmission | null>(null);
  const { data: userData } = useUserData();
  const canEditContent = canChangeContent(userData?.role ?? "USER");
  const canEndSeason = canChangeContent(userData?.role ?? "USER");

  const utils = api.useUtils();

  const deleteSeason = api.pvpRank.deleteSeason.useMutation();

  const endSeason = api.pvpRank.endSeason.useMutation();

  const { data: seasons } = api.pvpRank.getSeasons.useQuery();

  useEffect(() => {
    if (!seasons || seasons.length === 0) return;
    if (selectedSeasonId) return;

    const now = new Date();
    const activeSeason = seasons.find(
      (s) => new Date(s.startDate) <= now && now <= new Date(s.endDate),
    );
    if (activeSeason) {
      setSelectedSeasonId(activeSeason.id);
    }
  }, [seasons, selectedSeasonId]);

  const selectedSeason = seasons?.find((s) => s.id === selectedSeasonId);
  const isManagerPending =
    isCreatePending || isEditPending || isDeletePending || isEndPending;

  const handleEndSeason = async () => {
    if (!endTarget || endInFlightRef.current) return;

    const previousRetry = endRetryRef.current;
    const submission =
      previousRetry && deleteSeasonTargetsMatch(previousRetry.target, endTarget)
        ? previousRetry
        : {
            requestId: crypto.randomUUID(),
            target: copyDeleteSeasonTarget(endTarget),
          };
    endInFlightRef.current = submission;
    endRetryRef.current = submission;
    setIsEndPending(true);

    try {
      const result = await endSeason.mutateAsync({
        id: submission.target.id,
        expectedUpdatedAt: submission.target.updatedAt,
        expectedSeason: submission.target,
        requestId: submission.requestId,
      });
      if (endInFlightRef.current !== submission) return;
      if (!result.success) {
        showMutationToast(result);
        return;
      }

      const rewards = result.rewards ?? [];
      const resetUserIds = result.resetUserIds ?? [];
      const insertedRewardIds = result.insertedRewardIds ?? [];
      const clearedQueueUserIds = result.clearedQueueUserIds ?? [];
      const committed = result.committedSeason;
      const verified =
        result.ended === true &&
        result.requestId === submission.requestId &&
        result.seasonId === submission.target.id &&
        result.expectedUpdatedAt?.getTime() === submission.target.updatedAt.getTime() &&
        result.expectedSeason !== undefined &&
        deleteSeasonTargetsMatch(result.expectedSeason, submission.target) &&
        result.previousSeason !== undefined &&
        deleteSeasonTargetsMatch(result.previousSeason, submission.target) &&
        committed !== undefined &&
        committed.id === submission.target.id &&
        committed.name === submission.target.name &&
        committed.description === submission.target.description &&
        committed.startDate.getTime() === submission.target.startDate.getTime() &&
        committed.createdAt.getTime() === submission.target.createdAt.getTime() &&
        committed.paused === submission.target.paused &&
        committed.ended === true &&
        committed.updatedAt.getTime() > submission.target.updatedAt.getTime() &&
        committed.endDate.getTime() <= committed.updatedAt.getTime() &&
        JSON.stringify(canonicalDeleteValue(committed.rewards)) ===
          JSON.stringify(canonicalDeleteValue(submission.target.rewards)) &&
        result.rewardCount === rewards.length &&
        new Set(rewards.map((reward) => reward.id)).size === rewards.length &&
        new Set(rewards.map((reward) => reward.userId)).size === rewards.length &&
        result.resetUserCount === resetUserIds.length &&
        new Set(resetUserIds).size === resetUserIds.length &&
        new Set(insertedRewardIds).size === insertedRewardIds.length &&
        insertedRewardIds.every((id) => rewards.some((reward) => reward.id === id)) &&
        result.clearedQueueCount === clearedQueueUserIds.length &&
        new Set(clearedQueueUserIds).size === clearedQueueUserIds.length;
      if (!verified) {
        showMutationToast({
          success: false,
          message:
            "The server response could not be matched to this season. The confirmation is still open; please retry.",
        });
        return;
      }

      utils.pvpRank.getSeasons.setData(undefined, (cachedSeasons) =>
        cachedSeasons?.map((season) =>
          season.id === submission.target.id ? committed : season,
        ),
      );
      endRetryRef.current = null;
      setIsEndDialogOpen(false);
      setEndTarget(null);
      showMutationToast(result);
      await utils.pvpRank.getSeasons.invalidate();
    } catch {
      // The shared tRPC handler reports transport failures. Keep the exact immutable target and
      // request UUID so retry safely recovers a response lost after the season ended.
    } finally {
      if (endInFlightRef.current === submission) {
        endInFlightRef.current = null;
        setIsEndPending(false);
      }
    }
  };

  const handleDeleteSeason = async () => {
    if (!deleteTarget || deleteInFlightRef.current) return;

    const previousRetry = deleteRetryRef.current;
    const submission =
      previousRetry && deleteSeasonTargetsMatch(previousRetry.target, deleteTarget)
        ? previousRetry
        : {
            requestId: crypto.randomUUID(),
            target: copyDeleteSeasonTarget(deleteTarget),
          };
    deleteInFlightRef.current = submission;
    deleteRetryRef.current = submission;
    setIsDeletePending(true);

    try {
      const result = await deleteSeason.mutateAsync({
        id: submission.target.id,
        expectedUpdatedAt: submission.target.updatedAt,
        expectedSeason: submission.target,
        requestId: submission.requestId,
      });
      if (deleteInFlightRef.current !== submission) return;
      if (!result.success) {
        showMutationToast(result);
        return;
      }

      const verified =
        result.deleted === true &&
        result.requestId === submission.requestId &&
        result.seasonId === submission.target.id &&
        result.expectedUpdatedAt?.getTime() === submission.target.updatedAt.getTime() &&
        result.expectedSeason !== undefined &&
        deleteSeasonTargetsMatch(result.expectedSeason, submission.target) &&
        result.deletedSeason !== undefined &&
        deleteSeasonTargetsMatch(result.deletedSeason, submission.target) &&
        result.deletedUnclaimedRewardIds !== undefined &&
        new Set(result.deletedUnclaimedRewardIds).size ===
          result.deletedUnclaimedRewardIds.length &&
        result.deletedUnclaimedRewardCount === result.deletedUnclaimedRewardIds.length;
      if (!verified) {
        showMutationToast({
          success: false,
          message:
            "The server response could not be matched to this season. The confirmation is still open; please retry.",
        });
        return;
      }

      utils.pvpRank.getSeasons.setData(undefined, (cachedSeasons) =>
        cachedSeasons?.filter((season) => season.id !== submission.target.id),
      );
      setSelectedSeasonId((current) =>
        current === submission.target.id ? null : current,
      );
      deleteRetryRef.current = null;
      setIsDeleteDialogOpen(false);
      setDeleteTarget(null);
      showMutationToast(result);
      await utils.pvpRank.getSeasons.invalidate();
    } catch {
      // The shared tRPC handler reports transport failures. Keep the exact immutable target and
      // request UUID so retry safely recovers a response lost after the delete committed.
    } finally {
      if (deleteInFlightRef.current === submission) {
        deleteInFlightRef.current = null;
        setIsDeletePending(false);
      }
    }
  };

  const now = new Date();

  const isSeasonActive = selectedSeason
    ? new Date(selectedSeason.startDate) <= now &&
      now <= new Date(selectedSeason.endDate)
    : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-1">
        <Select
          value={selectedSeasonId || ""}
          onValueChange={setSelectedSeasonId}
          disabled={isManagerPending}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a season" />
          </SelectTrigger>
          <SelectContent>
            {seasons?.map((season) => (
              <SelectItem key={season.id} value={season.id}>
                {season.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canEditContent && (
          <div className="flex gap-2">
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={(open) => {
                if (!open && isCreatePending) return;
                setIsCreateDialogOpen(open);
              }}
            >
              <DialogTrigger asChild>
                <Button disabled={isManagerPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-h-[85vh] max-w-3xl overflow-y-auto"
                closeDisabled={isCreatePending}
                onEscapeKeyDown={(event) => {
                  if (isCreatePending) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                  if (isCreatePending) event.preventDefault();
                }}
              >
                <DialogHeader>
                  <DialogTitle>Create New Season</DialogTitle>
                </DialogHeader>
                <SeasonForm
                  onPendingChange={setIsCreatePending}
                  onSuccess={() => setIsCreateDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>

            {selectedSeason && (
              <>
                <Dialog
                  open={isEditDialogOpen}
                  onOpenChange={(open) => {
                    if (!open && isEditPending) return;
                    setIsEditDialogOpen(open);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline" disabled={isManagerPending}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    className="max-h-[85vh] max-w-3xl overflow-y-auto"
                    closeDisabled={isEditPending}
                    onEscapeKeyDown={(event) => {
                      if (isEditPending) event.preventDefault();
                    }}
                    onInteractOutside={(event) => {
                      if (isEditPending) event.preventDefault();
                    }}
                  >
                    <DialogHeader>
                      <DialogTitle>Edit Season</DialogTitle>
                    </DialogHeader>
                    <SeasonForm
                      seasonId={selectedSeason.id}
                      seasonRevision={new Date(selectedSeason.updatedAt)}
                      initialData={{
                        name: selectedSeason.name,
                        description: selectedSeason.description,
                        startDate: new Date(selectedSeason.startDate),
                        endDate: new Date(selectedSeason.endDate),
                        rewards: selectedSeason.rewards,
                        paused: selectedSeason.paused,
                      }}
                      onPendingChange={setIsEditPending}
                      onSuccess={() => setIsEditDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>

                {isSeasonActive && canEndSeason && (
                  <AlertDialog
                    open={isEndDialogOpen}
                    onOpenChange={(open) => {
                      if (!open) {
                        if (isEndPending) return;
                        setIsEndDialogOpen(false);
                        setEndTarget(null);
                        return;
                      }
                      if (isManagerPending) return;
                      setEndTarget(copyDeleteSeasonTarget(selectedSeason));
                      setIsEndDialogOpen(true);
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={isManagerPending}
                        aria-label={`End ${selectedSeason.name}`}
                        title={`End ${selectedSeason.name}`}
                      >
                        <StopCircle className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent
                      aria-busy={isEndPending}
                      onEscapeKeyDown={(event) => {
                        if (isEndPending) event.preventDefault();
                      }}
                    >
                      <AlertDialogHeader>
                        <AlertDialogTitle>End Season</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to end the season &quot;
                          {endTarget?.name ?? selectedSeason.name}&quot;? Rewards will
                          be distributed and players&apos; LP will be reset.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isEndPending}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          disabled={isEndPending}
                          onClick={(event) => {
                            event.preventDefault();
                            void handleEndSeason();
                          }}
                          className="bg-amber-500 text-white hover:bg-amber-600"
                        >
                          {isEndPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Ending
                            </>
                          ) : (
                            "End Season"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                      <p className="sr-only" aria-live="polite" role="status">
                        {isEndPending ? "Ending" : ""}
                      </p>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                <AlertDialog
                  open={isDeleteDialogOpen}
                  onOpenChange={(open) => {
                    if (!open) {
                      if (isDeletePending) return;
                      setIsDeleteDialogOpen(false);
                      setDeleteTarget(null);
                      return;
                    }
                    if (isManagerPending) return;
                    setDeleteTarget(copyDeleteSeasonTarget(selectedSeason));
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      disabled={isManagerPending}
                      aria-label={`Delete ${selectedSeason.name}`}
                      title={`Delete ${selectedSeason.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent
                    aria-busy={isDeletePending}
                    onEscapeKeyDown={(event) => {
                      if (isDeletePending) event.preventDefault();
                    }}
                  >
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Season</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete the season &quot;
                        {deleteTarget?.name ?? selectedSeason.name}&quot;? This action
                        cannot be undone. <b>NOTE:</b> All unclaimed rewards related to
                        this season will be deleted; claimed reward history is
                        preserved.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeletePending}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={isDeletePending}
                        onClick={(event) => {
                          event.preventDefault();
                          void handleDeleteSeason();
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isDeletePending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Deleting
                          </>
                        ) : (
                          "Delete season"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                    <p className="sr-only" aria-live="polite" role="status">
                      {isDeletePending ? "Deleting" : ""}
                    </p>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        )}
      </div>

      {selectedSeason && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{selectedSeason.name}</CardTitle>
            <div className="flex items-center gap-2">
              <SeasonStatusBadge season={selectedSeason} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-medium text-sm">Description</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                {selectedSeason.description}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium text-sm">Start Date</h3>
                <p className="mt-1 text-muted-foreground text-sm">
                  {format(new Date(selectedSeason.startDate), "PPP")}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-sm">End Date</h3>
                <p className="mt-1 text-muted-foreground text-sm">
                  {format(new Date(selectedSeason.endDate), "PPP")}
                </p>
              </div>
            </div>

            <div>
              <h3 className="font-medium text-sm">Division Rewards</h3>
              <div className="mt-2 space-y-1">
                {selectedSeason.rewards.map((division) => {
                  const rewardSummary = getRewardArray(division.rewards).join(" • ");
                  return (
                    <div
                      key={division.division}
                      className="grid grid-cols-4 items-center justify-between rounded-md border bg-muted/50 px-3 py-2"
                    >
                      <span className="font-medium">{division.division}</span>
                      <span className="col-span-3 text-muted-foreground text-sm">
                        {rewardSummary}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface SeasonStatusBadgeProps {
  season: {
    paused: boolean;
    startDate: Date;
    endDate: Date;
  };
}

const SeasonStatusBadge: React.FC<SeasonStatusBadgeProps> = ({ season }) => {
  const now = new Date();
  const start = new Date(season.startDate);
  const end = new Date(season.endDate);

  if (season.paused) {
    return (
      <Badge className="shrink-0" variant="destructive">
        Paused
      </Badge>
    );
  }

  if (start <= now && now <= end) {
    return (
      <Badge className="shrink-0" variant="default">
        Active
      </Badge>
    );
  }

  if (end < now) {
    return (
      <Badge className="shrink-0" variant="secondary">
        Completed
      </Badge>
    );
  }

  // Upcoming seasons – no badge for now
  return null;
};
