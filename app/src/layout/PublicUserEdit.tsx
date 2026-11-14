"use client";
import { Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ITEM_LEVEL_CAP } from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { useUserEditForm } from "@/hooks/profile";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { ActionSelector } from "@/layout/CombatActions";
import { EditContent } from "@/layout/EditContent";
import Modal from "@/layout/Modal";
import { getJutsuMaxLevel } from "@/libs/jutsuProgression";
import { showRetryableErrorToast } from "@/libs/retryableToast";
import { showMutationToast } from "@/libs/toast";
import {
  canChangeUserRolesTo,
  canEditBloodline,
  canEditItems,
  canEditJutsus,
  canEditQuests,
  canEditRank,
  canEditRankedLp,
  canEditStaffAccountFlag,
  canEditUsername,
  canEditVillage,
  isRestrictedToSelf,
} from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import type { UpdateUserSchema } from "@/validators/user";
import { updateUserSchema } from "@/validators/user";

export const EditUserComponent: React.FC<EditUserComponentProps> = ({
  userId,
  targetIsAi,
  profile,
  onUserQuestDeletionPendingChange,
}) => {
  // State
  const [jutsu, setJutsu] = useState<Jutsu | undefined>(undefined);
  const [selectedUserItemId, setSelectedUserItemId] = useState<string | undefined>(
    undefined,
  );
  const [showActive, setShowActive] = useState<string>("userData");
  const [selectedQuestType, setSelectedQuestType] = useState<string>("all");
  const [deletedUserQuestIds, setDeletedUserQuestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmedJutsuAdjustment, setConfirmedJutsuAdjustment] =
    useState<JutsuAdjustmentSnapshot | null>(null);
  const [committedJutsuAdjustments, setCommittedJutsuAdjustments] = useState<
    Map<string, CommittedJutsuAdjustment>
  >(() => new Map());
  const [confirmedItemAdjustment, setConfirmedItemAdjustment] =
    useState<ItemAdjustmentSnapshot | null>(null);
  const [committedItemLevels, setCommittedItemLevels] = useState<Map<string, number>>(
    () => new Map(),
  );
  const jutsuAdjustmentFlight = useSingleFlight<JutsuAdjustmentSnapshot>();
  const itemAdjustmentFlight = useSingleFlight<ItemAdjustmentSnapshot>();
  const isJutsuAdjustmentPending = jutsuAdjustmentFlight.isPending;
  const isItemAdjustmentPending = itemAdjustmentFlight.isPending;
  const currentTargetRef = useRef({
    userId,
    username: profile.username,
    isAi: targetIsAi,
  });
  const jutsuEditorTargetIdentityRef = useRef(`${userId}\u0000${profile.username}`);
  const itemEditorTargetIdentityRef = useRef(
    `${userId}\u0000${profile.username}\u0000${targetIsAi}`,
  );
  currentTargetRef.current = {
    userId,
    username: profile.username,
    isAi: targetIsAi,
  };
  const now = new Date();

  // Logged-in user – determines editing permissions
  const { data: currentUser } = useUserDataSelector((u) => ({
    userId: u.userId,
    role: u.role,
  }));
  const userRole = currentUser?.role || "USER";
  // Roles limited to self-editing may not read another user's items
  const restrictedToSelf = isRestrictedToSelf(userRole, currentUser?.userId, userId);

  // Permission checks
  const perms = {
    canEditUsername: canEditUsername(userRole),
    canEditBloodline: canEditBloodline(userRole),
    canEditVillage: canEditVillage(userRole),
    canEditRank: canEditRank(userRole),
    canEditJutsus: canEditJutsus(userRole),
    canEditItems: canEditItems(userRole) && !restrictedToSelf,
    canEditStaffAccountFlag: canEditStaffAccountFlag(userRole),
    canEditQuests: canEditQuests(userRole),
    canEditUserRoles: canChangeUserRolesTo(userRole),
    canEditRankedLp: canEditRankedLp(userRole),
  } as const;

  const canEditSomething = Object.values(perms).some(Boolean);

  // tRPC utility
  const utils = api.useUtils();

  const { data: userQuests } = api.quests.getUserQuests.useQuery(
    { userId: userId },
    { enabled: perms.canEditQuests && !!userId },
  );

  // Get unique quest types
  const questTypes = userQuests
    ? Array.from(new Set(userQuests.map((q) => q.quest.questType).filter(Boolean)))
    : [];

  // Filter quests by type
  const filteredQuests = userQuests?.filter(
    (quest) =>
      !deletedUserQuestIds.has(quest.id) &&
      (selectedQuestType === "all" || quest.quest.questType === selectedQuestType),
  );

  // Mutations
  // Form handling – pass permissions so queries are conditionally executed inside hook
  const { form, formData, userJutsus, handleUserSubmit } = useUserEditForm(
    userId,
    profile,
    {
      canEditUsername: perms.canEditUsername,
      canEditBloodline: perms.canEditBloodline,
      canEditVillage: perms.canEditVillage,
      canEditRank: perms.canEditRank,
      canEditJutsus: perms.canEditJutsus,
      canEditItems: perms.canEditItems,
      canEditStaffAccountFlag: perms.canEditStaffAccountFlag,
      canEditUserRoles: perms.canEditUserRoles,
      canEditRankedLp: perms.canEditRankedLp,
    },
  );

  // Jutsu-specific helpers
  const jutsuLevelForm = useForm<{ level: number; reskinId: string }>({
    defaultValues: {
      level: userJutsus?.find((uj) => uj.jutsuId === jutsu?.id)?.level || 0,
      reskinId:
        userJutsus?.find((uj) => uj.jutsuId === jutsu?.id)?.activeReskin?.id || "none",
    },
  });

  // Mutation for adjusting jutsu level
  const adjustJutsuLevel = api.jutsu.adjustUserJutsu.useMutation({
    meta: { handlesTransportError: true },
  });

  // Staff item level editing
  const { data: userItems } = api.item.getPublicUserItems.useQuery(
    { userId },
    { enabled: perms.canEditItems && !!userId },
  );
  const itemLevelForm = useForm<{ level: number }>({
    defaultValues: { level: 1 },
  });
  const adjustItemLevel = api.item.adjustUserItem.useMutation({
    meta: { handlesTransportError: true },
  });

  // Query all reskins for selected jutsu
  const { data: jutsuReskins } = api.jutsu.getReskinsForJutsu.useQuery(
    { jutsuId: jutsu?.id || "" },
    { enabled: perms.canEditJutsus && !!jutsu?.id },
  );

  // Note: reskin is applied via adjustJutsuLevel to keep a single update action

  // Derived – only relevant if jutsu editing is permitted
  const userJutsu = userJutsus?.find((uj) => uj.jutsuId === jutsu?.id);
  const committedJutsuAdjustment = userJutsu
    ? committedJutsuAdjustments.get(userJutsu.id)
    : undefined;
  const displayedJutsuLevel = committedJutsuAdjustment?.level ?? userJutsu?.level ?? 0;
  const displayedJutsuReskinId = committedJutsuAdjustment
    ? committedJutsuAdjustment.reskinId
    : (userJutsu?.activeReskin?.id ?? null);
  const displayedJutsuReskinName = committedJutsuAdjustment
    ? committedJutsuAdjustment.reskinName
    : (userJutsu?.activeReskin?.name ?? null);
  const allJutsus = userJutsus?.map((uj) => uj.jutsu);
  const userJutsuCounts = userJutsus?.map((userJutsu) => {
    const displayedLevel =
      committedJutsuAdjustments.get(userJutsu.id)?.level ?? userJutsu.level;
    return {
      id: userJutsu.jutsuId,
      quantity:
        userJutsu.finishTraining && userJutsu.finishTraining > now
          ? displayedLevel - 1
          : displayedLevel,
    };
  });
  const hasJutsus = perms.canEditJutsus && userJutsus && userJutsus.length > 0;

  const displayedUserItems = useMemo(
    () =>
      userItems?.map((ui) => ({
        ...ui,
        level: committedItemLevels.get(ui.id) ?? ui.level,
      })),
    [userItems, committedItemLevels],
  );
  const selectedUserItem = displayedUserItems?.find(
    (ui) => ui.id === selectedUserItemId,
  );
  const allOwnedItems = displayedUserItems?.map((ui) => ({
    ...ui.item,
    id: ui.id,
    name:
      ui.quantity > 1
        ? `${ui.item.name} x${ui.quantity}`
        : ui.equipped !== "NONE"
          ? `${ui.item.name} [${ui.equipped}]`
          : ui.item.name,
  }));
  const userItemLevels = displayedUserItems?.map((ui) => ({
    id: ui.id,
    level: ui.level,
  }));
  const hasItems = perms.canEditItems && userItems && userItems.length > 0;

  // Update jutsu form default values when selected jutsu changes
  useEffect(() => {
    if (userJutsu) {
      jutsuLevelForm.reset({
        level: displayedJutsuLevel,
        reskinId: displayedJutsuReskinId || "none",
      });
    }
  }, [userJutsu, displayedJutsuLevel, displayedJutsuReskinId, jutsuLevelForm]);

  useEffect(() => {
    if (!userJutsus || committedJutsuAdjustments.size === 0) return;
    setCommittedJutsuAdjustments((current) => {
      let next: Map<string, CommittedJutsuAdjustment> | undefined;
      for (const [rowId, committed] of current) {
        const refreshed = userJutsus.find((row) => row.id === rowId);
        if (
          refreshed?.level === committed.level &&
          (refreshed.activeReskin?.id ?? null) === committed.reskinId
        ) {
          next ??= new Map(current);
          next.delete(rowId);
        }
      }
      return next ?? current;
    });
  }, [userJutsus, committedJutsuAdjustments.size]);

  useEffect(() => {
    const targetIdentity = `${userId}\u0000${profile.username}`;
    if (jutsuEditorTargetIdentityRef.current === targetIdentity) return;
    if (isJutsuAdjustmentPending) return;
    jutsuEditorTargetIdentityRef.current = targetIdentity;
    setConfirmedJutsuAdjustment(null);
    setJutsu(undefined);
    setCommittedJutsuAdjustments(new Map());
  }, [userId, profile.username, isJutsuAdjustmentPending]);

  useEffect(() => {
    if (!userItems || committedItemLevels.size === 0) return;
    setCommittedItemLevels((current) => {
      let next: Map<string, number> | undefined;
      for (const [rowId, committedLevel] of current) {
        if (userItems.find((row) => row.id === rowId)?.level === committedLevel) {
          next ??= new Map(current);
          next.delete(rowId);
        }
      }
      return next ?? current;
    });
  }, [userItems, committedItemLevels.size]);

  useEffect(() => {
    const targetIdentity = `${userId}\u0000${profile.username}\u0000${targetIsAi}`;
    if (itemEditorTargetIdentityRef.current === targetIdentity) return;
    if (isItemAdjustmentPending) return;
    itemEditorTargetIdentityRef.current = targetIdentity;
    setConfirmedItemAdjustment(null);
    setSelectedUserItemId(undefined);
    setCommittedItemLevels(new Map());
  }, [userId, profile.username, targetIsAi, isItemAdjustmentPending]);

  const reviewJutsuAdjustment = jutsuLevelForm.handleSubmit((data) => {
    if (!userJutsu || !jutsu || isJutsuAdjustmentPending) return;
    const newReskinId = data.reskinId === "none" ? null : data.reskinId;
    const newReskinName = newReskinId
      ? (jutsuReskins?.find((reskin) => reskin.id === newReskinId)?.name ?? null)
      : null;
    if (newReskinId && !newReskinName) {
      jutsuLevelForm.setError("reskinId", {
        message: "The selected reskin is no longer available",
      });
      return;
    }
    if (data.level === displayedJutsuLevel && newReskinId === displayedJutsuReskinId) {
      jutsuLevelForm.setError("level", {
        message: "Change the level or reskin before reviewing",
      });
      return;
    }

    setConfirmedJutsuAdjustment({
      userId,
      username: profile.username,
      isAi: targetIsAi,
      userJutsuId: userJutsu.id,
      jutsuId: jutsu.id,
      jutsuName: jutsu.name,
      previousLevel: displayedJutsuLevel,
      newLevel: data.level,
      previousReskinName: displayedJutsuReskinName,
      newReskinId,
      newReskinName,
      equipped: userJutsu.equipped,
      finishTraining: userJutsu.finishTraining
        ? new Date(userJutsu.finishTraining)
        : null,
    });
  });

  const confirmJutsuAdjustment = async (snapshot: JutsuAdjustmentSnapshot) => {
    await jutsuAdjustmentFlight.run(snapshot, async () => {
      try {
        const result = await adjustJutsuLevel.mutateAsync({
          userId: snapshot.userId,
          jutsuId: snapshot.jutsuId,
          level: snapshot.newLevel,
          reskinId: snapshot.newReskinId,
        });
        if (
          currentTargetRef.current.userId !== snapshot.userId ||
          currentTargetRef.current.username !== snapshot.username
        ) {
          return;
        }

        if (!result.success) return showMutationToast(result);

        showMutationToast(result);
        // Overlay the exact committed row before refreshing. A stale query cannot put the old
        // level/reskin back into the form or count badge while the authoritative cache catches up.
        setCommittedJutsuAdjustments((current) => {
          const next = new Map(current);
          next.set(snapshot.userJutsuId, {
            level: snapshot.newLevel,
            reskinId: snapshot.newReskinId,
            reskinName: snapshot.newReskinName,
          });
          return next;
        });
        setConfirmedJutsuAdjustment(null);
        void Promise.allSettled([
          utils.profile.getPublicUser.invalidate({ userId: snapshot.userId }),
          utils.jutsu.getPublicUserJutsus.invalidate({ userId: snapshot.userId }),
        ]);
      } catch (error) {
        // Close and refresh because this endpoint has no replay key.
        showRetryableErrorToast(
          error,
          "The adjustment outcome is unknown. Refresh before trying again.",
        );
        setConfirmedJutsuAdjustment(null);
        void utils.jutsu.getPublicUserJutsus.invalidate({ userId: snapshot.userId });
      }
    });
  };

  const reviewItemAdjustment = itemLevelForm.handleSubmit((data) => {
    if (!selectedUserItem || itemAdjustmentFlight.current()) return;
    if (data.level === selectedUserItem.level) {
      itemLevelForm.setError("level", {
        message: "Change the level before reviewing",
      });
      return;
    }

    setConfirmedItemAdjustment({
      userId,
      username: profile.username,
      isAi: targetIsAi,
      userItemId: selectedUserItem.id,
      itemId: selectedUserItem.itemId,
      itemName: selectedUserItem.item.name,
      previousLevel: selectedUserItem.level,
      newLevel: data.level,
      quantity: selectedUserItem.quantity,
      experience: selectedUserItem.experience,
      equipped: selectedUserItem.equipped,
      durability: selectedUserItem.durability,
      dropChancePerc: selectedUserItem.dropChancePerc,
      storedAtHome: selectedUserItem.storedAtHome,
      isInAuction: selectedUserItem.isInAuction,
      activeVariantId: selectedUserItem.activeVariantId,
      craftingFinishedAt: selectedUserItem.craftingFinishedAt
        ? new Date(selectedUserItem.craftingFinishedAt)
        : null,
      imbuements: selectedUserItem.imbuements
        .map((imbuement) => ({
          id: imbuement.id,
          itemName: imbuement.item.name,
          craftingFinishedAt: new Date(imbuement.craftingFinishedAt),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  });

  const confirmItemAdjustment = async (snapshot: ItemAdjustmentSnapshot) => {
    await itemAdjustmentFlight.run(snapshot, async () => {
      try {
        const result = await adjustItemLevel.mutateAsync({
          userId: snapshot.userId,
          userItemId: snapshot.userItemId,
          level: snapshot.newLevel,
        });
        if (
          currentTargetRef.current.userId !== snapshot.userId ||
          currentTargetRef.current.username !== snapshot.username ||
          currentTargetRef.current.isAi !== snapshot.isAi
        ) {
          return;
        }

        if (!result.success) return showMutationToast(result);

        showMutationToast(result);
        // Publish the authoritative level immediately. A stale refetch cannot put the old level
        // back on the tile/form while the item query catches up.
        setCommittedItemLevels((current) => {
          const next = new Map(current);
          next.set(snapshot.userItemId, snapshot.newLevel);
          return next;
        });
        setConfirmedItemAdjustment(null);
        void utils.item.getPublicUserItems.invalidate({ userId: snapshot.userId });
      } catch (error) {
        // Close and refresh because this endpoint has no replay key.
        showRetryableErrorToast(
          error,
          "The adjustment outcome is unknown. Refresh before trying again.",
        );
        setConfirmedItemAdjustment(null);
        void utils.item.getPublicUserItems.invalidate({ userId: snapshot.userId });
      }
    });
  };

  useEffect(() => {
    if (selectedUserItem) {
      itemLevelForm.reset({ level: selectedUserItem.level });
    }
  }, [selectedUserItem, itemLevelForm]);

  // Cases where we don't render anything
  if (!currentUser) return null;
  if (!canEditSomething) return null;

  return (
    <Tabs
      defaultValue={showActive}
      className="flex flex-col items-center justify-center"
      onValueChange={(value) => setShowActive(value)}
    >
      <TabsList className="mt-3 text-center">
        <TabsTrigger value="userData">Main Data</TabsTrigger>
        {hasJutsus && <TabsTrigger value="jutsus">Jutsus Specifics</TabsTrigger>}
        {hasItems && <TabsTrigger value="items">Items Specifics</TabsTrigger>}
        {perms.canEditQuests && <TabsTrigger value="quests">Quests</TabsTrigger>}
      </TabsList>
      <TabsContent value="userData">
        <EditContent
          schema={updateUserSchema}
          form={form as unknown as UseFormReturn<UpdateUserSchema>}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save to Database"
          type="ai"
          relationId={userId}
          allowImageUpload={true}
          onAccept={handleUserSubmit}
        />
      </TabsContent>
      {hasJutsus && (
        <TabsContent value="jutsus">
          <div
            className={isJutsuAdjustmentPending ? "pointer-events-none opacity-60" : ""}
            aria-busy={isJutsuAdjustmentPending}
          >
            <div className="mt-5">
              <ActionSelector
                items={allJutsus}
                counts={userJutsuCounts}
                selectedId={jutsu?.id}
                labelSingles={true}
                emptyText="No jutsus assigned to this user"
                gridClassNameOverwrite="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12"
                onClick={(id) => {
                  if (jutsuAdjustmentFlight.current()) return;
                  if (id === jutsu?.id) {
                    setJutsu(undefined);
                  } else {
                    setJutsu(allJutsus?.find((jutsu) => jutsu.id === id));
                  }
                }}
                showBgColor={false}
                showLabels={true}
              />
            </div>
            {jutsu && (
              <div className="mt-4 flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <Form {...jutsuLevelForm}>
                    <form
                      onSubmit={reviewJutsuAdjustment}
                      className="flex w-full items-center justify-between gap-2"
                    >
                      <fieldset
                        disabled={isJutsuAdjustmentPending}
                        className="flex items-end gap-2"
                      >
                        <FormField
                          control={jutsuLevelForm.control}
                          name="level"
                          rules={{
                            required: "A jutsu level is required",
                            min: { value: 0, message: "Level cannot be below 0" },
                            max: {
                              value: getJutsuMaxLevel(jutsu),
                              message: `Level cannot exceed ${getJutsuMaxLevel(jutsu)}`,
                            },
                            validate: (value) =>
                              Number.isInteger(value) || "Level must be a whole number",
                          }}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Level</FormLabel>
                              <FormControl>
                                <NumberInput
                                  className="w-20"
                                  min={0}
                                  max={getJutsuMaxLevel(jutsu)}
                                  step={1}
                                  disabled={isJutsuAdjustmentPending}
                                  {...field}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {perms.canEditJutsus && (
                          <FormField
                            control={jutsuLevelForm.control}
                            name="reskinId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Reskin</FormLabel>
                                <Select
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  disabled={isJutsuAdjustmentPending}
                                >
                                  <SelectTrigger className="w-56">
                                    <SelectValue placeholder="None" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {jutsuReskins?.map((r) => (
                                      <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <Button type="submit" disabled={isJutsuAdjustmentPending}>
                          Review adjustment
                        </Button>
                      </fieldset>
                    </form>
                  </Form>
                </div>
              </div>
            )}
          </div>

          {confirmedJutsuAdjustment && (
            <Modal
              id={`adjust-user-jutsu-${confirmedJutsuAdjustment.userJutsuId}`}
              title="Review jutsu adjustment"
              isOpen
              setIsOpen={(open) => {
                if (!open && !isJutsuAdjustmentPending) {
                  setConfirmedJutsuAdjustment(null);
                }
              }}
              proceed_label="Adjust jutsu"
              proceed_loading_label="Adjusting"
              isLoading={isJutsuAdjustmentPending}
              keepOpenOnAccept
              onAccept={(event) => {
                event.preventDefault();
                void confirmJutsuAdjustment(confirmedJutsuAdjustment);
              }}
            >
              <div className="space-y-3" aria-busy={isJutsuAdjustmentPending}>
                <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3">
                  <p className="font-semibold">
                    {confirmedJutsuAdjustment.jutsuName} for{" "}
                    {confirmedJutsuAdjustment.username}
                    {confirmedJutsuAdjustment.isAi ? " (AI)" : ""}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">Target user ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedJutsuAdjustment.userId}
                      </code>
                    </dd>
                    <dt className="font-medium">Owned row ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedJutsuAdjustment.userJutsuId}
                      </code>
                    </dd>
                    <dt className="font-medium">Jutsu ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedJutsuAdjustment.jutsuId}
                      </code>
                    </dd>
                    <dt className="font-medium">Level</dt>
                    <dd>
                      {confirmedJutsuAdjustment.previousLevel} →{" "}
                      {confirmedJutsuAdjustment.newLevel}
                    </dd>
                    <dt className="font-medium">Reskin</dt>
                    <dd>
                      {confirmedJutsuAdjustment.previousReskinName ?? "None"} →{" "}
                      {confirmedJutsuAdjustment.newReskinName ?? "None"}
                    </dd>
                  </dl>
                </div>
                <p className="text-sm">
                  This sets the stored level and reskin to the values above. It does not
                  add a relative level increment.
                </p>
                <p className="text-muted-foreground text-sm">
                  Equipped/loadout assignments, experience, and training progress are
                  not changed.
                </p>
                {confirmedJutsuAdjustment.finishTraining &&
                  confirmedJutsuAdjustment.finishTraining > now && (
                    <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                      This jutsu is training until{" "}
                      {confirmedJutsuAdjustment.finishTraining.toLocaleString()}. The
                      adjustment will not finish or cancel that training.
                    </p>
                  )}
                {confirmedJutsuAdjustment.equipped && (
                  <p className="text-muted-foreground text-sm">
                    This jutsu is currently equipped; its equipped state remains
                    unchanged.
                  </p>
                )}
              </div>
            </Modal>
          )}
        </TabsContent>
      )}
      {hasItems && (
        <TabsContent value="items">
          <div
            className={isItemAdjustmentPending ? "pointer-events-none opacity-60" : ""}
            aria-busy={isItemAdjustmentPending}
          >
            <div className="mt-5">
              <ActionSelector
                items={allOwnedItems}
                levels={userItemLevels}
                selectedId={selectedUserItemId}
                emptyText="No items assigned to this user"
                gridClassNameOverwrite="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12"
                onClick={(id) => {
                  if (itemAdjustmentFlight.current()) return;
                  setSelectedUserItemId(id === selectedUserItemId ? undefined : id);
                }}
                showBgColor={false}
                showLabels={true}
              />
            </div>
            {selectedUserItem && (
              <div className="mt-4 flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <Form {...itemLevelForm}>
                    <form
                      onSubmit={reviewItemAdjustment}
                      className="flex w-full items-center justify-between gap-2"
                    >
                      <fieldset
                        disabled={isItemAdjustmentPending}
                        className="flex items-end gap-2"
                      >
                        <FormField
                          control={itemLevelForm.control}
                          name="level"
                          rules={{
                            required: "An item level is required",
                            min: { value: 1, message: "Level cannot be below 1" },
                            max: {
                              value: ITEM_LEVEL_CAP,
                              message: `Level cannot exceed ${ITEM_LEVEL_CAP}`,
                            },
                            validate: (value) =>
                              Number.isInteger(value) || "Level must be a whole number",
                          }}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Level</FormLabel>
                              <FormControl>
                                <NumberInput
                                  className="w-20"
                                  min={1}
                                  max={ITEM_LEVEL_CAP}
                                  step={1}
                                  disabled={isItemAdjustmentPending}
                                  {...field}
                                  onValueChange={field.onChange}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" disabled={isItemAdjustmentPending}>
                          Review adjustment
                        </Button>
                      </fieldset>
                    </form>
                  </Form>
                </div>
              </div>
            )}
          </div>

          {confirmedItemAdjustment && (
            <Modal
              id={`adjust-user-item-${confirmedItemAdjustment.userItemId}`}
              title="Review item adjustment"
              isOpen
              setIsOpen={(open) => {
                if (!open && !isItemAdjustmentPending) {
                  setConfirmedItemAdjustment(null);
                }
              }}
              proceed_label="Adjust item"
              proceed_loading_label="Adjusting"
              isLoading={isItemAdjustmentPending}
              keepOpenOnAccept
              onAccept={(event) => {
                event.preventDefault();
                void confirmItemAdjustment(confirmedItemAdjustment);
              }}
            >
              <div className="space-y-3" aria-busy={isItemAdjustmentPending}>
                <p className="sr-only" aria-live="polite">
                  {isItemAdjustmentPending ? "Adjusting" : ""}
                </p>
                <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-3">
                  <p className="font-semibold">
                    {confirmedItemAdjustment.itemName} for{" "}
                    {confirmedItemAdjustment.username}
                    {confirmedItemAdjustment.isAi ? " (AI)" : ""}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-medium">Target user ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedItemAdjustment.userId}
                      </code>
                    </dd>
                    <dt className="font-medium">Owned row ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedItemAdjustment.userItemId}
                      </code>
                    </dd>
                    <dt className="font-medium">Base item ID</dt>
                    <dd>
                      <code className="break-all">
                        {confirmedItemAdjustment.itemId}
                      </code>
                    </dd>
                    <dt className="font-medium">Level</dt>
                    <dd>
                      {confirmedItemAdjustment.previousLevel} →{" "}
                      {confirmedItemAdjustment.newLevel}
                    </dd>
                    <dt className="font-medium">Quantity</dt>
                    <dd>{confirmedItemAdjustment.quantity}</dd>
                    <dt className="font-medium">Experience</dt>
                    <dd>{confirmedItemAdjustment.experience}</dd>
                    <dt className="font-medium">Equipped</dt>
                    <dd>{confirmedItemAdjustment.equipped}</dd>
                    <dt className="font-medium">Durability</dt>
                    <dd>{confirmedItemAdjustment.durability}</dd>
                    <dt className="font-medium">Drop chance</dt>
                    <dd>{confirmedItemAdjustment.dropChancePerc}%</dd>
                    <dt className="font-medium">Variant</dt>
                    <dd>{confirmedItemAdjustment.activeVariantId ?? "None"}</dd>
                    <dt className="font-medium">Storage</dt>
                    <dd>
                      {confirmedItemAdjustment.storedAtHome ? "At home" : "Carried"}
                    </dd>
                  </dl>
                </div>
                <p className="text-sm">
                  This sets the level on this exact owned row to the value above. It is
                  an absolute value, not a relative increment.
                </p>
                <p className="text-muted-foreground text-sm">
                  Quantity, experience, equipment/loadout assignment, durability, drop
                  chance, storage, variant, crafting state, auction state, and
                  imbuements are preserved.
                </p>
                {confirmedItemAdjustment.quantity > 1 && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This row is a stack of {confirmedItemAdjustment.quantity}. The level
                    applies to the entire owned stack row.
                  </p>
                )}
                {confirmedItemAdjustment.equipped !== "NONE" && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This item is currently equipped in{" "}
                    {confirmedItemAdjustment.equipped}; its assignment is unchanged.
                  </p>
                )}
                {confirmedItemAdjustment.isInAuction && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This exact row is currently listed for sale. The listing remains
                    active and will reflect the adjusted level.
                  </p>
                )}
                {confirmedItemAdjustment.craftingFinishedAt && (
                  <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    This item has crafting state ending{" "}
                    {confirmedItemAdjustment.craftingFinishedAt.toLocaleString()}; the
                    timer is unchanged.
                  </p>
                )}
                {confirmedItemAdjustment.imbuements.length > 0 && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                    <p>
                      Imbuements remain unchanged (
                      {confirmedItemAdjustment.imbuements.length}):
                    </p>
                    <ul className="list-disc pl-5">
                      {confirmedItemAdjustment.imbuements.map((imbuement) => (
                        <li key={imbuement.id}>
                          {imbuement.itemName} ({imbuement.id})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Modal>
          )}
        </TabsContent>
      )}
      {perms.canEditQuests && (
        <TabsContent value="quests">
          <div className="mt-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">User Quests</h3>
              {questTypes.length > 0 && (
                <select
                  className="rounded-md border border-border bg-card px-3 py-1 text-foreground"
                  value={selectedQuestType}
                  onChange={(e) => setSelectedQuestType(e.target.value)}
                >
                  <option value="all">All Quest Types</option>
                  {questTypes.map((type, i) => (
                    <option key={`${type}-${i}`} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {filteredQuests && filteredQuests.length > 0 ? (
              <div className="space-y-2">
                {filteredQuests.map((userQuest) => (
                  <div
                    key={userQuest.id}
                    className="flex items-center justify-between rounded-lg border-2 border-border bg-card p-3"
                  >
                    <div>
                      <h4 className="font-semibold text-foreground">
                        {userQuest.quest.name}
                      </h4>
                      <p className="text-muted-foreground text-sm">
                        Started: {userQuest.startedAt.toLocaleString()}
                        {userQuest.endAt &&
                          ` • Completed: ${userQuest.endAt.toLocaleString()}`}
                      </p>
                      {userQuest.quest.questType && (
                        <p className="text-muted-foreground text-sm">
                          Type: {userQuest.quest.questType}
                        </p>
                      )}
                    </div>
                    <DeleteUserQuestControl
                      userId={userId}
                      username={profile.username}
                      userQuest={userQuest}
                      onPendingChange={onUserQuestDeletionPendingChange}
                      onDeleted={(userQuestId) =>
                        setDeletedUserQuestIds((current) => {
                          const next = new Set(current);
                          next.add(userQuestId);
                          return next;
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground">
                No quests found for this user.
              </p>
            )}
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
};

const DeleteUserQuestControl: React.FC<{
  userId: string;
  username: string;
  userQuest: EditableUserQuest;
  onDeleted: (userQuestId: string) => void;
  onPendingChange?: (isPending: boolean) => void;
}> = ({ userId, username, userQuest, onDeleted, onPendingChange }) => {
  const utils = api.useUtils();
  const [confirmedQuest, setConfirmedQuest] =
    useState<UserQuestDeletionSnapshot | null>(null);
  const deletionFlight = useSingleFlight<UserQuestDeletionSnapshot>();
  const isPending = deletionFlight.isPending;
  const deleteUserQuest = api.quests.deleteUserQuest.useMutation({
    meta: { handlesTransportError: true },
  });

  const openConfirmation = () => {
    if (deletionFlight.current()) return;
    setConfirmedQuest({
      userId,
      username,
      userQuestId: userQuest.id,
      questId: userQuest.quest.id,
      questName: userQuest.quest.name,
      questType: userQuest.quest.questType,
      startedAt: new Date(userQuest.startedAt),
      endAt: userQuest.endAt ? new Date(userQuest.endAt) : null,
      completed: userQuest.completed,
    });
  };

  const confirmDeletion = async (snapshot: UserQuestDeletionSnapshot) => {
    if (!deletionFlight.claim(snapshot)) return;
    onPendingChange?.(true);

    try {
      const result = await deleteUserQuest.mutateAsync({
        userId: snapshot.userId,
        questId: snapshot.questId,
      });
      if (!result.success) return showMutationToast(result);

      showMutationToast(result);
      // Suppress the committed record before cache work. A stale refetch cannot resurrect its
      // delete action while the authoritative query is catching up.
      onDeleted(snapshot.userQuestId);
      setConfirmedQuest(null);
      void utils.quests.getUserQuests.invalidate({ userId: snapshot.userId });
    } catch (error) {
      // Close and refresh because this endpoint has no replay key.
      showRetryableErrorToast(
        error,
        "The deletion outcome is unknown. Refresh before trying again.",
      );
      setConfirmedQuest(null);
      void utils.quests.getUserQuests.invalidate({ userId: snapshot.userId });
    } finally {
      deletionFlight.release(snapshot);
      onPendingChange?.(false);
    }
  };

  const status = confirmedQuest ? questRecordStatus(confirmedQuest) : null;

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        aria-label={`Delete ${userQuest.quest.name} quest record from ${username}`}
        disabled={isPending}
        onClick={openConfirmation}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {confirmedQuest && (
        <Modal
          id={`delete-user-quest-${confirmedQuest.userQuestId}`}
          title="Permanently delete quest record?"
          isOpen
          setIsOpen={(open) => {
            if (!open) setConfirmedQuest(null);
          }}
          proceed_label="Delete quest record"
          proceed_loading_label="Deleting"
          confirmClassName="bg-red-600 text-white hover:bg-red-700"
          isLoading={isPending}
          keepOpenOnAccept
          onAccept={(event) => {
            event.preventDefault();
            void confirmDeletion(confirmedQuest);
          }}
        >
          <div className="space-y-3" aria-busy={isPending}>
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
              <p className="font-semibold text-red-700 dark:text-red-300">
                This permanently removes {confirmedQuest.questName} from
                {` ${confirmedQuest.username}`}&apos;s quest history.
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="font-medium">Type</dt>
                <dd>{confirmedQuest.questType}</dd>
                <dt className="font-medium">Status</dt>
                <dd>{status}</dd>
                <dt className="font-medium">Started</dt>
                <dd>{confirmedQuest.startedAt.toLocaleString()}</dd>
                <dt className="font-medium">History ID</dt>
                <dd>
                  <code className="break-all">{confirmedQuest.userQuestId}</code>
                </dd>
              </dl>
            </div>
            <p className="text-sm">
              The stored attempt/completion history and retry-period state for this
              quest will be reset. Any active tracker is removed, and this quest&apos;s
              active NPC slot is released. The quest may become available to start
              again.
            </p>
            <p className="text-muted-foreground text-sm">
              Rewards already granted, aggregate mission counters, and the user&apos;s
              global quest-finish time are not rolled back. Other quest records are
              unaffected.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
};

const questRecordStatus = (quest: Pick<EditableUserQuest, "completed" | "endAt">) => {
  if (!quest.endAt && quest.completed === 0) return "Active";
  if (quest.completed > 0) return "Completed";
  return "Ended without completion";
};

interface EditUserComponentProps {
  userId: string;
  targetIsAi: boolean;
  profile: UpdateUserSchema;
  onUserQuestDeletionPendingChange?: (isPending: boolean) => void;
}

type EditableUserQuest = RouterOutputs["quests"]["getUserQuests"][number];

type JutsuAdjustmentSnapshot = {
  userId: string;
  username: string;
  isAi: boolean;
  userJutsuId: string;
  jutsuId: string;
  jutsuName: string;
  previousLevel: number;
  newLevel: number;
  previousReskinName: string | null;
  newReskinId: string | null;
  newReskinName: string | null;
  equipped: boolean;
  finishTraining: Date | null;
};

type CommittedJutsuAdjustment = {
  level: number;
  reskinId: string | null;
  reskinName: string | null;
};

type EditableUserItem = RouterOutputs["item"]["getPublicUserItems"][number];

type ItemAdjustmentSnapshot = {
  userId: string;
  username: string;
  isAi: boolean;
  userItemId: string;
  itemId: string;
  itemName: string;
  previousLevel: number;
  newLevel: number;
  quantity: number;
  experience: number;
  equipped: EditableUserItem["equipped"];
  durability: number;
  dropChancePerc: number;
  storedAtHome: boolean;
  isInAuction: boolean;
  activeVariantId: string | null;
  craftingFinishedAt: Date | null;
  imbuements: Array<{
    id: string;
    itemName: string;
    craftingFinishedAt: Date;
  }>;
};

type UserQuestDeletionSnapshot = {
  userId: string;
  username: string;
  userQuestId: string;
  questId: string;
  questName: string;
  questType: EditableUserQuest["quest"]["questType"];
  startedAt: Date;
  endAt: Date | null;
  completed: number;
};
