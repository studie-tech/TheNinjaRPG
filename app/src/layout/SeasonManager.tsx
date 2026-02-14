"use client";

import { format } from "date-fns";
import { Pencil, Plus, StopCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import SeasonForm from "./SeasonForm";

export function SeasonManager() {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { data: userData } = useUserData();
  const canEditContent = canChangeContent(userData?.role ?? "USER");
  const canEndSeason = canChangeContent(userData?.role ?? "USER");

  const utils = api.useUtils();

  const deleteSeason = api.pvpRank.deleteSeason.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.pvpRank.getSeasons.invalidate();
        setSelectedSeasonId(null);
      }
    },
  });

  const endSeason = api.pvpRank.endSeason.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.pvpRank.getSeasons.invalidate();
      }
    },
  });

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

  const now = new Date();

  const isSeasonActive = selectedSeason
    ? new Date(selectedSeason.startDate) <= now &&
      now <= new Date(selectedSeason.endDate)
    : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-1">
        <Select value={selectedSeasonId || ""} onValueChange={setSelectedSeasonId}>
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
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Season</DialogTitle>
                </DialogHeader>
                <SeasonForm onSuccess={() => setIsCreateDialogOpen(false)} />
              </DialogContent>
            </Dialog>

            {selectedSeason && (
              <>
                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Edit Season</DialogTitle>
                    </DialogHeader>
                    <SeasonForm
                      seasonId={selectedSeason.id}
                      initialData={{
                        name: selectedSeason.name,
                        description: selectedSeason.description,
                        startDate: new Date(selectedSeason.startDate),
                        endDate: new Date(selectedSeason.endDate),
                        rewards: selectedSeason.rewards,
                        paused: selectedSeason.paused,
                      }}
                      onSuccess={() => setIsEditDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>

                {isSeasonActive && canEndSeason && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline">
                        <StopCircle className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>End Season</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to end the season &quot;
                          {selectedSeason.name}&quot;? Rewards will be distributed and
                          players&apos; LP will be reset.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => endSeason.mutate({ id: selectedSeason.id })}
                          className="bg-amber-500 text-white hover:bg-amber-600"
                        >
                          End Season
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Season</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete the season &quot;
                        {selectedSeason.name}&quot;? This action cannot be undone.{" "}
                        <b>NOTE:</b>
                        This will delete all unclaimed rewards related to this season as
                        well!
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteSeason.mutate({ id: selectedSeason.id })}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
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
