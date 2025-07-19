"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import Loader from "@/layout/Loader";
import Image from "next/image";
import Table from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IMG_BUILDING_MISSIONHALL } from "@/drizzle/constants";
import { showMutationToast } from "@/libs/toast";
import { createBountySchema } from "@/validators/bounty";
import { getSearchValidator } from "@/validators/register";
import { showUserRank } from "@/libs/profile";
import { Eye, Trophy, Users, X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { canSeeHiddenBountyInfo } from "@/utils/permissions";
import type { ColumnDefinitionType } from "@/layout/Table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { z } from "zod";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { useRequiredUserData } from "@/utils/UserContext";
import { useInfinitePagination } from "@/libs/pagination";

type CreateBountyFormData = z.infer<typeof createBountySchema>;
type UserSearchFormData = z.infer<ReturnType<typeof getSearchValidator>>;

interface BountyBoardProps {
  userData: NonNullable<UserWithRelations>;
}

export default function BountyBoard({ userData }: BountyBoardProps) {
  const util = api.useUtils();
  const { updateUser } = useRequiredUserData();
  const [bountyStatus, setBountyStatus] = useState<
    "OPEN" | "CLAIMED" | "EXPIRED" | "CANCELLED" | "all"
  >("OPEN");
  const [addingMoneyTo, setAddingMoneyTo] = useState<string | null>(null);
  const [addMoneyAmount, setAddMoneyAmount] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const isStaff = canSeeHiddenBountyInfo(userData.role);

  const form = useForm<CreateBountyFormData>({
    resolver: zodResolver(createBountySchema),
    defaultValues: {
      targetUserId: "",
      amountRyo: 0,
    },
  });

  const userSearchForm = useForm<UserSearchFormData>({
    resolver: zodResolver(getSearchValidator({ max: 1 })),
    defaultValues: {
      username: "",
      users: [],
    },
  });

  const selectedUsers = useWatch({
    control: userSearchForm.control,
    name: "users",
    defaultValue: [],
  });

  useEffect(() => {
    if (selectedUsers?.[0]) {
      form.setValue("targetUserId", selectedUsers[0].userId);
    } else {
      form.setValue("targetUserId", "");
    }
  }, [selectedUsers, form]);

  // Query
  const {
    data,
    isLoading,
    isFetching,
    hasNextPage,
    fetchNextPage,
  } = api.bounty.board.useInfiniteQuery(
    {
      limit: 20,
      status: bountyStatus,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  // Flatten all pages data
  const allBounties = data?.pages.flatMap(page => page.data) ?? [];

  // Use infinite pagination hook
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Mutations
  const { mutate: createBounty, isPending: isCreating } = api.bounty.create.useMutation(
    {
      onSuccess: async (resp) => {
        showMutationToast(resp);
        if (resp.success) {
          await util.bounty.board.invalidate();
          form.reset();
          userSearchForm.reset();
        }
      },
    },
  );

  const { mutate: signup, isPending: isSigningup } = api.bounty.signup.useMutation({
    onSuccess: async (d) => {
      showMutationToast(d);
      await util.bounty.board.invalidate();
    },
  });

  const { mutate: collectBounty, isPending: isCollecting } =
    api.bounty.collect.useMutation({
      onSuccess: async (d) => {
        showMutationToast(d);
        await util.bounty.board.invalidate();
      },
    });

  const { mutate: retractBounty, isPending: isRetracting } =
    api.bounty.retract.useMutation({
      onSuccess: async (d) => {
        showMutationToast(d);
        await util.bounty.board.invalidate();
      },
    });

  const { mutate: stopTracking, isPending: isStoppingTracking } =
    api.bounty.stopTracking.useMutation({
      onSuccess: async (d) => {
        showMutationToast(d);
        await util.bounty.board.invalidate();
      },
    });

  const { mutate: addMoney, isPending: isAddingMoney } =
    api.bounty.addMoney.useMutation({
      onSuccess: async (data, variables) => {
        showMutationToast(data);
        if (data.success) {
          setAddingMoneyTo(null);
          setAddMoneyAmount(0);
          setIsModalOpen(false);
          await util.bounty.board.invalidate();
          await updateUser({ money: userData.money - variables.amountRyo });
        }
      },
    });

  const { mutate: removeAllTrackers, isPending: isRemovingTrackers } =
    api.bounty.removeAllTrackers.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await util.bounty.board.invalidate();
        }
      },
    });

  const onSubmit = (data: CreateBountyFormData) => {
    if (selectedUsers.length === 0) {
      showMutationToast({ success: false, message: "Please select a target user" });
      return;
    }
    createBounty(data);
  };

  // Guard
  if (isLoading) return <Loader explanation="Loading bounty board" />;

  // Table
  const columns: ColumnDefinitionType<any, any>[] = [
    {
      key: "avatar",
      header: "",
      type: "avatar",
    },
    {
      key: "targetInfo",
      header: "Target",
      type: "jsx",
    },
    {
      key: "amountRyo",
      header: "Ryo",
      type: "jsx",
    },
    {
      key: "hunters",
      header: "Hunters",
      type: "jsx",
    },
    ...(allBounties.some((b) => b.creatorUser)
      ? [
          {
            key: "creatorInfo",
            header: "Creator",
            type: "jsx" as const,
          },
        ]
      : []),
    ...(allBounties.some((b) => b.huntingUsers)
      ? [
          {
            key: "huntingInfo",
            header: "Hunting",
            type: "jsx" as const,
          },
        ]
      : []),
  ];

  return (
    <div>
      <Image
        alt="welcome"
        src={IMG_BUILDING_MISSIONHALL}
        width={512}
        height={195}
        className="w-full"
        priority={true}
      />
      <p className="text-center font-bold px-3 pt-2">
        Bounties are a way to earn Ryo by killing other players, or put targets on
        players you want taken down a notch.
      </p>

      <div className="p-3">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
              <div className="lg:col-span-2">
                <FormLabel>Target User</FormLabel>
                <UserSearchSelect
                  useFormMethods={userSearchForm}
                  label="Search for target user"
                  showYourself={false}
                  showAi={false}
                  inline={true}
                  maxUsers={1}
                />
              </div>
              <FormField
                control={form.control}
                name="amountRyo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ryo Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Enter ryo amount"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button
              type="submit"
              disabled={
                isCreating || !form.formState.isValid || selectedUsers.length === 0
              }
              className="w-full"
            >
              {isCreating ? "Creating..." : "Create Bounty"}
            </Button>
          </form>
        </Form>
      </div>

      {isStaff && (
        <div className="flex justify-end items-center gap-2 p-2">
          <Select
            value={bountyStatus}
            onValueChange={(
              value: "OPEN" | "CLAIMED" | "EXPIRED" | "CANCELLED" | "all",
            ) => setBountyStatus(value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="CLAIMED">Claimed</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <Table
        data={allBounties.map((b) => ({
          ...b,
          avatar: b.targetUser?.avatar,
          targetInfo: b.targetUser ? (
            <div>
              <p className="font-bold">{b.targetUser.username}</p>
              <p>
                Lvl. {b.targetUser.level}{" "}
                {showUserRank({
                  rank: b.targetUser.rank,
                  isOutlaw: b.targetUser.isOutlaw,
                })}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-bold text-gray-500">Unknown User</p>
            </div>
          ),
          amountRyo: (
            <div className="flex items-center gap-2">
              <span>{b.amountRyo.toLocaleString()}</span>
              {b.status === "OPEN" && (
                <Dialog
                  open={isModalOpen && addingMoneyTo === b.id}
                  onOpenChange={(open) => {
                    setIsModalOpen(open);
                    if (!open) {
                      setAddingMoneyTo(null);
                      setAddMoneyAmount(0);
                    }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddingMoneyTo(b.id);
                        setIsModalOpen(true);
                      }}
                      disabled={isAddingMoney}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add Money to Bounty</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor="amount"
                          className="block text-sm font-medium mb-2"
                        >
                          Amount (Ryo)
                        </label>
                        <Input
                          id="amount"
                          type="number"
                          placeholder="Enter amount"
                          value={addMoneyAmount}
                          onChange={(e) =>
                            setAddMoneyAmount(parseInt(e.target.value) || 0)
                          }
                          min="1"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setIsModalOpen(false);
                            setAddingMoneyTo(null);
                            setAddMoneyAmount(0);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() =>
                            addMoney({ bountyId: b.id, amountRyo: addMoneyAmount })
                          }
                          disabled={isAddingMoney || addMoneyAmount <= 0}
                        >
                          Add Money
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          ),
          hunters: `${b.huntersCount} / 3`,
          creatorInfo: b.creatorUser ? (
            <div>
              <p className="font-bold">{b.creatorUser.username}</p>
              <p>
                Lvl. {b.creatorUser.level}{" "}
                {showUserRank({
                  rank: b.creatorUser.rank,
                  isOutlaw: b.creatorUser.isOutlaw,
                })}
              </p>
            </div>
          ) : undefined,
          huntingInfo: b.huntingUsers ? (
            <div className="space-y-1">
              {b.huntingUsers?.map((hunter, idx) => (
                <div key={idx} className="text-sm">
                  <p className="font-medium">{hunter?.username ?? "Unknown User"}</p>
                  <p className="text-xs text-gray-600">
                    Lvl. {hunter?.level ?? "Unknown"}{" "}
                    {showUserRank({
                      rank: hunter?.rank ?? "NONE",
                      isOutlaw: hunter?.isOutlaw ?? false,
                    })}
                  </p>
                </div>
              ))}
              {b.huntingUsers.length === 0 && (
                <p className="text-sm text-gray-500">No hunters yet</p>
              )}
            </div>
          ) : undefined,
          actionButton: (() => {
            // Staff can remove all trackers from open bounties
            if (isStaff && b.status === "OPEN" && b.huntersCount > 0) {
              return (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => removeAllTrackers({ bountyId: b.id })}
                  disabled={isRemovingTrackers}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Remove All Trackers ({b.huntersCount})
                </Button>
              );
            }
            // User can retract if they created the bounty and it's still open
            if (
              "creatorUserId" in b &&
              b.creatorUserId === userData?.userId &&
              b.status === "OPEN"
            ) {
              return (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => retractBounty({ bountyId: b.id })}
                  disabled={isRetracting}
                >
                  <X className="h-4 w-4 mr-2" />
                  Retract
                </Button>
              );
            }
            // User can collect if they're tracking and bounty is claimed but not yet collected
            if (b.youSignedUp && b.status === "CLAIMED" && !b.collectedAt) {
              return (
                <Button
                  size="sm"
                  onClick={() => collectBounty({ bountyId: b.id })}
                  disabled={isCollecting}
                >
                  <Trophy className="h-4 w-4 mr-2" />
                  Collect
                </Button>
              );
            }
            // User can track if not signed up and bounty is open with space
            if (!b.youSignedUp && b.huntersCount < 3 && b.status === "OPEN") {
              return (
                <Button
                  size="sm"
                  onClick={() =>
                    signup({ bountyId: b.id, targetUserId: b.targetUserId })
                  }
                  disabled={isSigningup}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Track
                </Button>
              );
            }
            // User is tracking an open bounty
            if (b.youSignedUp && b.status === "OPEN") {
              return (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => stopTracking({ bountyId: b.id })}
                  disabled={isStoppingTracking}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Stop Tracking
                </Button>
              );
            }
            if (b.status === "CLAIMED" && b.collectedAt) {
              return (
                <Badge className="p-2" variant="outline">
                  <Trophy className="h-4 w-4 mr-2" />
                  Collected by{" "}
                  {b.claimedByUserId === userData?.userId
                    ? "You"
                    : (b.claimedByUser?.username ?? "Unknown")}
                </Badge>
              );
            }
            // Bounty is full or closed
            return null;
          })(),
        }))}
        columns={[
          ...columns,
          {
            key: "actionButton",
            header: "Action",
            type: "jsx",
          },
        ]}
        setLastElement={setLastElement}
      />
      
      {/* Show loading indicator when fetching more data */}
      {isFetching && (
        <div className="flex justify-center p-4">
          <Loader explanation="Loading more bounties" />
        </div>
      )}
    </div>
  );
}
