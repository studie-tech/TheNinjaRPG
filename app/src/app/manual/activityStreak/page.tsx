"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import { Button } from "@/components/ui/button";
import { api } from "@/app/_trpc/client";
import { FilePlus, Trash2 } from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRewardArray } from "@/libs/objectives";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import type { ActivityStreakConfig, ActivityStreakReward } from "@/drizzle/schema";

type ConfigWithRewards = ActivityStreakConfig & { rewards: ActivityStreakReward[] };

export default function ActivityStreakListPage() {
  const { data: userData } = useUserData();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<ConfigWithRewards | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "RECURRING" | "EVENT_PASS">(
    "all",
  );
  const router = useRouter();

  const {
    data: configs,
    isFetching,
    refetch,
  } = api.activityStreak.getConfigs.useQuery(
    typeFilter === "all" ? {} : { streakType: typeFilter },
  );

  const { mutate: create, isPending: createPending } =
    api.activityStreak.createConfig.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await refetch();
          router.push(`/manual/activityStreak/edit/${data.message}`);
        }
      },
    });

  const { mutate: remove, isPending: deletePending } =
    api.activityStreak.deleteConfig.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await refetch();
          setIsOpen(false);
          setSelectedConfig(null);
        }
      },
    });

  const isPending = isFetching || createPending || deletePending;

  // Check if a RECURRING config already exists
  const hasRecurring = configs?.some((c) => c.streakType === "RECURRING");

  const handleCreate = () => {
    // Default to EVENT_PASS if RECURRING already exists
    const streakType = hasRecurring ? "EVENT_PASS" : "RECURRING";
    create({
      name: streakType === "RECURRING" ? "Daily Login Streak" : "New Event Pass",
      totalDays: 30,
      streakType,
      isActive: false,
      ryoCost: 0,
      repsCost: 0,
      seichiSilverCost: 0,
      rewards: [{ dayNumber: 1, rewards: {} }],
    });
  };

  return (
    <ContentBox
      title="Activity Streak Configurations"
      subtitle="Manage daily login streaks and event passes"
      defaultBackHref="/manual"
      topRightContent={
        userData && canChangeContent(userData.role) ? (
          <Button id="create-config" onClick={handleCreate} disabled={isPending}>
            <FilePlus className="mr-2 h-6 w-6" />
            New
          </Button>
        ) : undefined
      }
    >
      <p className="mb-4">
        Configure activity streak rewards that players can claim daily. RECURRING
        streaks apply to all players automatically. EVENT_PASS streaks can be purchased
        by players.
      </p>

      <Tabs
        value={typeFilter}
        onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="RECURRING">Recurring</TabsTrigger>
          <TabsTrigger value="EVENT_PASS">Event Pass</TabsTrigger>
        </TabsList>

        <TabsContent value={typeFilter}>
          {isPending && <Loader explanation="Loading configurations..." />}

          {!isPending && (!configs || configs.length === 0) && (
            <p className="text-muted-foreground">No streak configurations found.</p>
          )}

          {!isPending && configs && configs.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {configs.map((config) => (
                <Card
                  key={config.id}
                  className="cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => {
                    setSelectedConfig(config);
                    setIsOpen(true);
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex flex-col items-start justify-between">
                      <CardTitle className="text-lg">{config.name}</CardTitle>
                      <div className="flex gap-1">
                        <Badge
                          variant={
                            config.streakType === "RECURRING" ? "default" : "secondary"
                          }
                        >
                          {config.streakType}
                        </Badge>
                        <Badge variant={config.isActive ? "default" : "outline"}>
                          {config.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {config.description || "No description"}
                    </p>
                    <div className="mt-2 text-sm">
                      <span className="font-medium">{config.totalDays}</span> days
                      {config.streakType === "EVENT_PASS" && (
                        <>
                          {" • "}
                          {(() => {
                            const costs: string[] = [];
                            if (config.ryoCost > 0) costs.push(`${config.ryoCost} ryo`);
                            if (config.repsCost > 0)
                              costs.push(`${config.repsCost} reps`);
                            if (config.seichiSilverCost > 0)
                              costs.push(`${config.seichiSilverCost} silver`);
                            return costs.length > 0 ? costs.join(" / ") : "Free";
                          })()}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {isOpen && userData && selectedConfig && (
        <Modal2
          title="Configuration Details"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
          className="max-w-3xl"
        >
          {!isPending && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{selectedConfig.name}</h2>
                <div className="flex gap-2">
                  <Badge
                    variant={
                      selectedConfig.streakType === "RECURRING"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {selectedConfig.streakType}
                  </Badge>
                  <Badge variant={selectedConfig.isActive ? "default" : "outline"}>
                    {selectedConfig.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>

              {selectedConfig.description && (
                <p className="text-muted-foreground">{selectedConfig.description}</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium">Total Days</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedConfig.totalDays} days
                  </p>
                </div>
                {selectedConfig.streakType === "EVENT_PASS" && (
                  <div>
                    <h3 className="text-sm font-medium">Cost</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedConfig.ryoCost > 0 && `${selectedConfig.ryoCost} ryo `}
                      {selectedConfig.repsCost > 0 &&
                        `${selectedConfig.repsCost} reps `}
                      {selectedConfig.seichiSilverCost > 0 &&
                        `${selectedConfig.seichiSilverCost} silver`}
                      {selectedConfig.ryoCost === 0 &&
                        selectedConfig.repsCost === 0 &&
                        selectedConfig.seichiSilverCost === 0 &&
                        "Free"}
                    </p>
                  </div>
                )}
              </div>

              {selectedConfig.startDate && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium">Start Date</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(selectedConfig.startDate).toLocaleDateString()}
                    </p>
                  </div>
                  {selectedConfig.endDate && (
                    <div>
                      <h3 className="text-sm font-medium">End Date</h3>
                      <p className="text-sm text-muted-foreground">
                        {new Date(selectedConfig.endDate).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Day Rewards</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {selectedConfig.rewards
                    .sort((a, b) => a.dayNumber - b.dayNumber)
                    .map((reward) => {
                      const rewardSummary = getRewardArray(reward.rewards).join(" • ");
                      return (
                        <div
                          key={reward.id}
                          className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2"
                        >
                          <span className="font-medium">Day {reward.dayNumber}</span>
                          <span className="text-sm text-muted-foreground">
                            {rewardSummary || "No rewards"}
                          </span>
                        </div>
                      );
                    })}
                  {selectedConfig.rewards.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No rewards configured
                    </p>
                  )}
                </div>
              </div>

              {canChangeContent(userData.role) && (
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    onClick={() =>
                      router.push(`/manual/activityStreak/edit/${selectedConfig.id}`)
                    }
                  >
                    Edit Configuration
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete &quot;{selectedConfig.name}
                          &quot;? This will also delete all user progress for this
                          configuration. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove({ id: selectedConfig.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          )}
          {isPending && <Loader explanation="Processing..." />}
        </Modal2>
      )}
    </ContentBox>
  );
}
