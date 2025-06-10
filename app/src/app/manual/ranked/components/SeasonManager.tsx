"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { api } from "@/app/_trpc/client";
import SeasonForm from "./SeasonForm";
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
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil } from "lucide-react";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export function SeasonManager() {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { data: userData } = useUserData();
  const canEditContent = canChangeContent(userData?.role ?? "USER");

  const { data: seasons } = api.ranked.getSeasons.useQuery();

  const selectedSeason = seasons?.find((s) => s.id === selectedSeasonId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select
          value={selectedSeasonId || ""}
          onValueChange={setSelectedSeasonId}
        >
          <SelectTrigger className="w-[300px]">
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
                  <Plus className="mr-2 h-4 w-4" />
                  New Season
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Create New Season</DialogTitle>
                </DialogHeader>
                <SeasonForm
                  onSuccess={() => setIsCreateDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>

            {selectedSeason && (
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Season
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
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
                    }}
                    onSuccess={() => setIsEditDialogOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}
      </div>

      {selectedSeason && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedSeason.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Description</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedSeason.description}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium">Start Date</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {format(new Date(selectedSeason.startDate), "PPP")}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium">End Date</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {format(new Date(selectedSeason.endDate), "PPP")}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium">Division Rewards</h3>
              <div className="mt-2 space-y-4">
                {selectedSeason.rewards.map((division, index) => (
                  <Card key={index}>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{division.division}</h4>
                        </div>
                        <div className="space-y-2">
                          {division.rewards.map((reward, rewardIndex) => (
                            <div
                              key={rewardIndex}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="capitalize">{reward.type}</span>
                              <span>{reward.amount}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
} 