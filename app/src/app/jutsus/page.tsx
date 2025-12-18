"use client";

import { useState } from "react";
import { Trash2, CircleFadingArrowUp, ArrowRightLeft, Palette } from "lucide-react";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ContentBox from "@/layout/ContentBox";
import Modal2 from "@/layout/Modal2";
import Loader from "@/layout/Loader";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Confirm2 from "@/layout/Confirm2";
import { SquareChevronRight, SquareChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OctagonX } from "lucide-react";
import { ActionSelector } from "@/layout/CombatActions";
import { calcJutsuEquipLimit } from "@/libs/train";
import {
  checkJutsuElements,
  checkJutsuBloodline,
  checkJutsuVillage,
  checkJutsuRank,
  checkJutsuItems,
  hasRequiredRank,
  hasRequiredLevel,
} from "@/libs/train";
import { useRequiredUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import { getUserElements } from "@/validators/user";
import { showMutationToast } from "@/libs/toast";
import { JUTSU_XP_TO_LEVEL } from "@/drizzle/constants";
import { COST_EXTRA_JUTSU_SLOT } from "@/drizzle/constants";
import { MAX_EXTRA_JUTSU_SLOTS } from "@/drizzle/constants";
import {
  JUTSU_TRANSFER_COST,
  JUTSU_TRANSFER_MAX_LEVEL,
  JUTSU_TRANSFER_MINIMUM_LEVEL,
  JUTSU_TRANSFER_DAYS,
} from "@/drizzle/constants";
import { getFreeTransfers } from "@/libs/jutsu";
import JutsuFiltering, { useFiltering, getFilter } from "@/layout/JutsuFiltering";
import { canTransferJutsu } from "@/utils/permissions";
import Countdown from "@/layout/Countdown";
import { secondsFromDate, DAY_S } from "@/utils/time";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COST_RESKIN_JUTSU, RESKIN_LIMIT } from "@/drizzle/constants";
import { canReskinFreely } from "@/utils/permissions";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { jutsuReskinCreateSchema } from "@/validators/jutsu";
import type { JutsuReskinCreateSchema } from "@/validators/jutsu";
import type { UserJutsuWithRelations } from "@/drizzle/schema";
import { Label } from "@/components/ui/label";
import { UploadButton } from "@/utils/uploadthing";
import AvatarImage from "@/layout/Avatar";

export default function MyJutsu() {
  // tRPC utility
  const utils = api.useUtils();

  // Two-level filtering
  const state = useFiltering();

  // Settings
  const now = new Date();
  const { data: userData, updateUser } = useRequiredUserData();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isReskinOpen, setIsReskinOpen] = useState<boolean>(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [userjutsu, setUserJutsu] = useState<UserJutsuWithRelations | undefined>(
    undefined,
  );
  const [transferTarget, setTransferTarget] = useState<
    UserJutsuWithRelations | undefined
  >(undefined);
  const transferCost = canTransferJutsu(userData) ? 0 : JUTSU_TRANSFER_COST;
  const [transferValue, setTransferValue] = useState<number>(1);
  const [modalType, setModalType] = useState<string | null>(null);
  const [reskinData, setReskinData] = useState<JutsuReskinCreateSchema | null>(null);

  // Reskin form
  const reskinForm = useForm<JutsuReskinCreateSchema>({
    mode: "onChange",
    resolver: zodResolver(jutsuReskinCreateSchema),
    defaultValues: {
      jutsuId: "",
      name: "",
      description: "",
      battleDescription: "",
      image: undefined,
    },
  });

  // User Jutsus & items
  const { data: userJutsus, isFetching: l1 } = api.jutsu.getUserJutsus.useQuery(
    getFilter(state),
    { enabled: !!userData },
  );
  const { data: userItems, isFetching: l2 } = api.item.getUserItems.useQuery(
    undefined,
    { enabled: !!userData },
  );
  const { data: userReskins } = api.jutsu.getUserReskins.useQuery(undefined, {
    enabled: !!userData,
  });
  const { data: recentTransfers } = api.jutsu.getRecentTransfers.useQuery(undefined, {
    enabled: !!userData,
  });

  const userJutsuCounts = userJutsus?.map((userJutsu) => {
    return {
      id: userJutsu.id,
      quantity:
        userJutsu.finishTraining && userJutsu.finishTraining > now
          ? userJutsu.level - 1
          : userJutsu.level,
    };
  });

  // Transfer costs
  const prevFreeTransfers =
    recentTransfers?.filter((t) =>
      (t.changes as string[]).some((c) => c.includes("Used free transfer.")),
    ) || [];
  const freeTransfers = getFreeTransfers(userData?.federalStatus || "NONE");
  const usedTransfers = prevFreeTransfers?.length || 0;

  // Calculate when free transfers reset
  const getFreeTransferResetTime = () => {
    if (!recentTransfers || recentTransfers.length === 0) return null;

    // Find the oldest transfer that used a free transfer
    const oldestFreeTransfer = prevFreeTransfers.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0];

    if (!oldestFreeTransfer) return null;

    // Add JUTSU_TRANSFER_DAYS to the oldest transfer date using secondsFromDate
    return secondsFromDate(
      JUTSU_TRANSFER_DAYS * DAY_S,
      new Date(oldestFreeTransfer.createdAt),
    );
  };

  const freeTransferResetTime = getFreeTransferResetTime();

  const onSettled = () => {
    document.body.style.cursor = "default";
    setIsOpen(false);
    setUserJutsu(undefined);
    setTransferTarget(undefined);
  };

  // Mutations
  const { mutate: equip, isPending: isToggling } = api.jutsu.toggleEquip.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.jutsu.getUserJutsus.invalidate();
      }
      // Optimistically update loadout
      if (data?.data && userData) {
        const currentLoadout = userData?.loadout?.jutsuIds || [];
        const jutsuId = data.data.jutsuId;
        const newLoadout = data?.data.equipped
          ? [...currentLoadout, jutsuId]
          : currentLoadout.filter((id) => id !== jutsuId);
        await updateUser({ loadout: { jutsuIds: newLoadout } });
      }
    },
    onSettled,
  });

  const { mutate: unequipAll, isPending: isUnequipping } =
    api.jutsu.unequipAll.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.jutsu.getUserJutsus.invalidate();
        }
      },
      onSettled,
    });

  const { mutate: forget, isPending: isForgetting } = api.jutsu.forget.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.jutsu.getUserJutsus.invalidate();
      }
    },
    onSettled,
  });

  const { mutate: updateOrder } = api.jutsu.updateUserJutsuOrder.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  const { mutate: buyJutsuSlot, isPending: isUpgrading } =
    api.blackmarket.buyJutsuSlot.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  const { mutate: transferLevel, isPending: isTransferring } =
    api.jutsu.transferLevel.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && userData) {
          await utils.jutsu.getUserJutsus.invalidate(); // Refresh Jutsu list
          await utils.jutsu.getRecentTransfers.invalidate(); // 🔹 Refresh free transfers
          await utils.profile.getUser.invalidate(); // Refresh user profile to update free transfer count
          if (usedTransfers >= freeTransfers && transferCost > 0) {
            await updateUser({
              reputationPoints: userData.reputationPoints - transferCost,
            });
          }
        }
      },
      onSettled,
    });

  const { mutate: reskin, isPending: isReskinning } =
    api.jutsu.createReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.jutsu.getUserJutsus.invalidate();
          setIsReskinOpen(false);
          setUserJutsu(undefined);
        }
      },
    });

  const { mutate: removeReskin, isPending: isRemovingReskin } =
    api.jutsu.removeReskin.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.jutsu.getUserJutsus.invalidate(),
            utils.jutsu.getUserReskins.invalidate(),
          ]);
          setIsOpen(false);
        }
      },
    });

  const isPending =
    isToggling ||
    isForgetting ||
    isUpgrading ||
    isUnequipping ||
    isTransferring ||
    isReskinning ||
    isRemovingReskin;
  const isFetching = l1 || l2;

  // Collapse UserItem and Item
  const userElements = new Set(getUserElements(userData));
  const actionItems = userJutsus?.map((uj) => {
    let warning = "";
    if (userData) {
      if (!checkJutsuItems(uj.jutsu, userItems)) {
        warning = `No ${uj.jutsu.jutsuWeapon.toLowerCase()} weapon equipped.`;
      }
      if (!checkJutsuElements(uj.jutsu, userElements)) {
        warning = "You do not have the required elements to use this jutsu.";
      }
      if (!hasRequiredRank(userData.rank, uj.jutsu.requiredRank)) {
        warning = "You do not have the required rank to use this jutsu.";
      }
      if (!hasRequiredLevel(userData.level, uj.jutsu.requiredLevel)) {
        warning = "You do not have the required level to use this jutsu.";
      }
      if (!checkJutsuRank(uj.jutsu.jutsuRank, userData.rank)) {
        warning = "You do not have the required rank to use this jutsu.";
      }
      if (!checkJutsuVillage(uj.jutsu, userData)) {
        warning = "You do not have the required village to use this jutsu.";
      }
      if (!checkJutsuBloodline(uj.jutsu, userData)) {
        warning = "You do not have the required bloodline to use this jutsu.";
      }
    }
    return {
      ...uj.jutsu,
      ...uj,
      type: "jutsu" as const,
      highlight: !!uj.equipped,
      warning,
      isReskinned: !!uj.activeReskin,
    };
  });

  // Sort if we have a loadout
  if (userData?.loadout?.jutsuIds && userJutsus) {
    userJutsus.sort((a, b) => {
      const aIndex = userData?.loadout?.jutsuIds.indexOf(a.jutsuId) ?? -1;
      const bIndex = userData?.loadout?.jutsuIds.indexOf(b.jutsuId) ?? -1;
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  // Derived calculations
  const curEquip = userJutsus?.filter((j) => j.equipped).length;
  const maxEquip = userData && calcJutsuEquipLimit(userData);
  const canEquip = curEquip !== undefined && maxEquip && curEquip < maxEquip;
  const subtitle =
    curEquip && maxEquip
      ? `Equipped ${curEquip}/${maxEquip}`
      : "Jutsus you want to use in combat";
  const activeReskins = userJutsus?.filter((uj) => uj.activeReskin);

  // Ryo from forgetting
  const forgetRyo = 0;

  // Loaders
  if (!userData) return <Loader explanation="Loading userdata" />;

  // Can afford removing
  const canUpgrade = userData.reputationPoints >= COST_EXTRA_JUTSU_SLOT;

  // Calculate reskin cost based on permissions
  const reskinCost = canReskinFreely(userData?.role) ? 0 : COST_RESKIN_JUTSU;

  return (
    <>
      <ContentBox
        title="Jutsu Management"
        subtitle={subtitle}
        bottomRightContent={
          <Button onClick={() => unequipAll()}>
            <OctagonX className="h-6 w-6 mr-2" />
            Unequip All
          </Button>
        }
        topRightContent={
          !isOpen && (
            <div className="flex flex-row items-center gap-2">
              <JutsuLoadoutSelector />
              <JutsuFiltering state={state} />
              {userData.extraJutsuSlots < MAX_EXTRA_JUTSU_SLOTS && (
                <Confirm2
                  title="Extra Jutsu Slot"
                  proceed_label={
                    canUpgrade
                      ? `Purchase for ${COST_EXTRA_JUTSU_SLOT} reps`
                      : `Need ${userData.reputationPoints - COST_EXTRA_JUTSU_SLOT} more reps`
                  }
                  isValid={!isPending}
                  button={
                    <Button animation="pulse">
                      <CircleFadingArrowUp className="h-6 w-6" />
                    </Button>
                  }
                  onAccept={(e) => {
                    e.preventDefault();
                    if (canUpgrade) buyJutsuSlot();
                  }}
                >
                  <p>
                    You are about to purchase an extra jutsu slot for{" "}
                    {COST_EXTRA_JUTSU_SLOT} reputation points. You currently have{" "}
                    {userData.reputationPoints} points. Are you sure?
                  </p>
                </Confirm2>
              )}
            </div>
          )
        }
      >
        {isFetching && <Loader explanation="Loading Jutsu" />}
        <ActionSelector
          items={actionItems}
          counts={userJutsuCounts}
          labelSingles={true}
          onClick={(id) => {
            setUserJutsu(userJutsus?.find((uj) => uj.id === id));
            setIsOpen(true);
          }}
          showBgColor={false}
          showLabels={true}
          emptyText="You have not learned any jutsu. Go to the training grounds in your village to learn some."
        />
        {isOpen && userData && userjutsu && (
          <Modal2
            title="Edit Jutsu"
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            proceed_label={
              !isToggling
                ? userjutsu.equipped
                  ? "Unequip"
                  : canEquip
                    ? "Equip"
                    : "Unequip other first"
                : undefined
            }
            isValid={false}
            onAccept={() => {
              if (canEquip || userjutsu.equipped) {
                equip({ userJutsuId: userjutsu.id });
              } else {
                setIsOpen(false);
              }
            }}
            confirmClassName={
              canEquip
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-red-600 text-white hover:bg-red-700"
            }
          >
            <div>
              <p>- You have {userData.money.toLocaleString()} ryo in your pocket</p>
              <p>- Need {JUTSU_XP_TO_LEVEL - userjutsu.experience} XP more to level</p>
            </div>
            {!isPending && (
              <>
                <ItemWithEffects
                  item={userjutsu.jutsu}
                  key={userjutsu.id}
                  showStatistic="jutsu"
                />
                {userReskins?.find((r) => r.jutsuId === userjutsu.jutsuId) &&
                  !userjutsu.activeReskin &&
                  !userjutsu.activeReskin && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-blue-700">
                        <Palette className="h-4 w-4 inline mr-1" />
                        This jutsu has been previously reskinned. You can create a new
                        reskin for free.
                      </p>
                    </div>
                  )}
                <div className="flex flex-row gap-3 items-center">
                  {userData.loadout?.jutsuIds.includes(userjutsu.jutsuId) && (
                    <>
                      <SquareChevronLeft
                        className="h-8 w-8 hover:text-orange-300 hover:cursor-pointer"
                        onClick={() =>
                          updateOrder({
                            jutsuId: userjutsu.jutsuId,
                            loadoutId: userData?.jutsuLoadout ?? "",
                            moveForward: false,
                          })
                        }
                      />
                      <p>Order</p>
                      <SquareChevronRight
                        className="h-8 w-8 hover:text-orange-300 hover:cursor-pointer"
                        onClick={() =>
                          updateOrder({
                            jutsuId: userjutsu.jutsuId,
                            loadoutId: userData?.jutsuLoadout ?? "",
                            moveForward: true,
                          })
                        }
                      />
                    </>
                  )}

                  <div className="grow"></div>
                  {userjutsu.level >= JUTSU_TRANSFER_MINIMUM_LEVEL &&
                    userjutsu.level <= JUTSU_TRANSFER_MAX_LEVEL && (
                      <Confirm2
                        title="Transfer Level"
                        button={
                          <Button id="transfer" variant="secondary">
                            <ArrowRightLeft className="h-6 w-6 sm:mr-2" />
                            <p className="hidden sm:block">Transfer Level</p>
                          </Button>
                        }
                        proceed_label={transferTarget ? "Confirm Transfer" : null}
                        onClose={() => {
                          setTransferTarget(undefined);
                          setTransferValue(1);
                        }}
                        isValid={false}
                        onAccept={(e) => {
                          e.preventDefault();
                          if (transferTarget) {
                            transferLevel({
                              fromJutsuId: userjutsu.jutsuId,
                              toJutsuId: transferTarget.jutsuId,
                              transferLevels: transferValue,
                            });
                          }
                        }}
                      >
                        {transferTarget ? (
                          <>
                            <p>
                              Transfer{" "}
                              <input
                                type="number"
                                min={1}
                                max={Math.min(
                                  userjutsu.level - 1,
                                  JUTSU_TRANSFER_MAX_LEVEL - transferTarget.level,
                                )}
                                value={transferValue}
                                onChange={(e) =>
                                  setTransferValue(parseInt(e.target.value) || 1)
                                }
                                style={{
                                  width: "50px",
                                  margin: "0 5px",
                                  backgroundColor: "white",
                                  color: "black",
                                  border: "1px solid #ccc",
                                  padding: "2px 4px",
                                }}
                              />{" "}
                              level(s) from {userjutsu.jutsu.name} to{" "}
                              {transferTarget.jutsu.name}?
                            </p>
                            <p>
                              This will subtract {transferValue} level
                              {transferValue > 1 ? "s" : ""} from {userjutsu.jutsu.name}{" "}
                              (new level: {userjutsu.level - transferValue}) and add{" "}
                              {transferValue} level{transferValue > 1 ? "s" : ""} to{" "}
                              {transferTarget.jutsu.name} (new level:{" "}
                              {transferTarget.level + transferValue}).
                            </p>
                            <p>
                              Cost:{" "}
                              {usedTransfers < freeTransfers
                                ? `Free (${Math.max(0, freeTransfers - usedTransfers)} remaining)`
                                : `${transferCost} reputation points`}
                            </p>
                          </>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <p>Select a jutsu to transfer the level to.</p>
                            <ActionSelector
                              items={userJutsus
                                ?.filter(
                                  (uj) =>
                                    uj.jutsu.jutsuType === userjutsu.jutsu.jutsuType &&
                                    uj.jutsu.jutsuRank === userjutsu.jutsu.jutsuRank &&
                                    uj.id !== userjutsu.id,
                                )
                                ?.map((uj) => ({
                                  id: uj.id,
                                  name: uj.jutsu.name,
                                  image: uj.jutsu.image,
                                  effects: uj.jutsu.effects,
                                  type: "jutsu" as const,
                                }))}
                              counts={userJutsuCounts}
                              labelSingles={true}
                              showBgColor={false}
                              showLabels={true}
                              onClick={(id) => {
                                setTransferTarget(
                                  userJutsus?.find((uj) => uj.id === id),
                                );
                              }}
                            />
                          </div>
                        )}
                      </Confirm2>
                    )}
                  {userjutsu.activeReskin ? (
                    <Confirm2
                      title="Remove Reskin"
                      button={
                        <Button id="remove-reskin" variant="destructive">
                          <Palette className="h-6 w-6 sm:mr-2" />
                          <p className="hidden sm:block">Remove Reskin</p>
                        </Button>
                      }
                      onAccept={(e) => {
                        e.preventDefault();
                        removeReskin({ userJutsuId: userjutsu.id });
                      }}
                    >
                      <p>
                        Are you sure you want to remove the reskin for this jutsu? This
                        will restore the original name and description.
                      </p>
                    </Confirm2>
                  ) : (
                    <Button
                      id="reskin"
                      variant="outline"
                      onClick={() => {
                        // Pre-fill with current reskin data if it exists
                        reskinForm.reset({
                          jutsuId: userjutsu.jutsuId,
                          name: userjutsu.activeReskin?.name ?? userjutsu.jutsu.name,
                          description:
                            userjutsu.activeReskin?.description ??
                            userjutsu.jutsu.description,
                          battleDescription:
                            userjutsu.activeReskin?.battleDescription ??
                            userjutsu.jutsu.battleDescription,
                          image: undefined,
                        });
                        setIsOpen(false);
                        setIsReskinOpen(true);
                        setModalType("reskin");
                      }}
                      disabled={
                        isPending ||
                        userjutsu.jutsu.jutsuType === "SPECIAL" ||
                        userjutsu.jutsu.jutsuType === "BLOODLINE"
                      }
                    >
                      <Palette className="h-6 w-6 sm:mr-2" />
                      <p className="hidden sm:block">Reskin</p>
                    </Button>
                  )}
                  <Confirm2
                    title="Forget Jutsu"
                    button={
                      <Button id="return" variant="destructive">
                        <Trash2 className="h-6 w-6 sm:mr-2" />
                        <p className="hidden sm:block">{`Forget [${forgetRyo} ryo]`}</p>
                      </Button>
                    }
                    onAccept={(e) => {
                      e.preventDefault();
                      forget({ id: userjutsu.id });
                    }}
                  >
                    <p>Confirm to forget this jutsu and get back {forgetRyo} ryo.</p>
                  </Confirm2>
                </div>
              </>
            )}
            {isPending && <Loader explanation={`Processing ${userjutsu.jutsu.name}`} />}
          </Modal2>
        )}
        {modalType === "reskin" && userjutsu && isReskinOpen && (
          <Modal2
            title={
              userjutsu.activeReskin ? "Update Jutsu Reskin" : "Create Jutsu Reskin"
            }
            isOpen={isReskinOpen}
            setIsOpen={setIsReskinOpen}
            proceed_label={userjutsu.activeReskin ? "Update Reskin" : "Create Reskin"}
            isValid={reskinForm.formState.isValid}
            className="w-[800px] max-w-[99%] max-h-[99%]"
            onAccept={() => {
              if (!isReskinning && userjutsu) {
                const data = reskinForm.getValues();
                setReskinData(data);
                setIsReskinOpen(false);
                setIsConfirmOpen(true);
              }
            }}
          >
            <div className="flex flex-col gap-4">
              <div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reskinForm.formState.isValid) {
                      const data = reskinForm.getValues();
                      setReskinData(data);
                      setIsReskinOpen(false);
                      setIsConfirmOpen(true);
                    }
                  }}
                  className="space-y-4 grid grid-cols-3 gap-4"
                >
                  <div className="space-y-2 row-span-3">
                    <p className="text-sm text-muted-foreground">
                      Optional: upload a new image for this reskin
                    </p>
                    <div className="flex items-center gap-3 flex-col">
                      <AvatarImage
                        href={reskinForm.watch("image") || userjutsu.jutsu.image}
                        alt={userjutsu.jutsu.name}
                        size={64}
                        hover_effect={false}
                      />
                      <UploadButton
                        endpoint="imageUploader"
                        onClientUploadComplete={(res) => {
                          const url = res?.[0]?.url;
                          if (url) {
                            reskinForm.setValue("image", url, { shouldValidate: true });
                          }
                        }}
                        onUploadError={(error: Error) => {
                          showMutationToast({ success: false, message: error.message });
                        }}
                      />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="name">Jutsu Name</Label>
                    <Input
                      placeholder="New jutsu name"
                      defaultValue={userjutsu.jutsu.name}
                      {...reskinForm.register("name")}
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="description">Jutsu Description</Label>
                    <Textarea
                      placeholder="New jutsu description"
                      defaultValue={userjutsu.jutsu.description}
                      {...reskinForm.register("description")}
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="battleDescription">Battle Description</Label>
                    <Textarea
                      placeholder="New battle description"
                      defaultValue={userjutsu.jutsu.battleDescription}
                      {...reskinForm.register("battleDescription")}
                    />
                  </div>
                </form>
              </div>
              <div>
                <div>
                  <strong className="text-red-500">
                    {userjutsu.activeReskin
                      ? "Updating a reskin is free."
                      : `Creating a reskin costs ${reskinCost} reputation points!`}
                  </strong>
                  <br />
                  <br />
                  <strong>Reskin Usage:</strong>
                  <br />
                  You have used {activeReskins?.length || 0}/
                  {userData.extraReskinSlots + RESKIN_LIMIT} available reskins.
                  <br />
                  <br />
                  Reskins are a way to personalize your jutsu&apos;s name, description,
                  and in-combat flavor text. These are cosmetic only and must follow the
                  rules below (as well as the overall game rules)
                  <br />
                  <br />
                  <strong>What You Can Change:</strong>
                  <br />
                  You are allowed to modify only the following:
                  <br />
                  - Jutsu Name
                  <br />
                  - Jutsu Description (what shows outside of combat)
                  <br />
                  - Battle Description (what appears in combat, e.g., &quot;%user
                  attacks %target&quot;)
                  <br />
                  <br />
                  <ul className="list-disc pl-6">
                    <li>
                      <code>%user</code> or <code>%target</code>: The acting user&apos;s
                      username.
                    </li>
                    <li>
                      <code>%user_subject</code> or <code>%target_subject</code>: (
                      <span className="italic">&quot;he&quot; or &quot;she&quot;</span>
                      ).
                    </li>
                    <li>
                      <code>%user_object</code> or <code>%target_object</code>: (
                      <span className="italic">&quot;him&quot; or &quot;her&quot;</span>
                      ).
                    </li>
                    <li>
                      <code>%user_posessive</code> or <code>%target_posessive</code>: (
                      <span className="italic">
                        &quot;his&quot; or &quot;hers&quot;
                      </span>
                      ).
                    </li>
                    <li>
                      <code>%user_reflexive</code> or <code>%target_reflexive</code>: (
                      <span className="italic">
                        &quot;himself&quot; or &quot;herself&quot;
                      </span>
                      ).
                    </li>
                    <li>
                      <code>%location</code>: The location of the action, formatted as{" "}
                      <span className="italic">[row, col]</span>.
                    </li>
                  </ul>
                </div>
                <div>
                  <strong>Tone & Content Restrictions:</strong>
                  <br />
                  - No hostile, mocking, or negative wording toward other players,
                  clans, villages, bloodlines, or jutsu.
                  <br />
                  - No profanity, slurs, or real-world political/religious references.
                  <br />
                  - No inappropriate humor or immersion-breaking language.
                  <br />
                  - No subtle digs or sarcasm aimed at others. If it could be taken
                  negatively, it&apos;s not allowed.
                  <br />
                  <br />
                  <strong>Example:</strong>
                  <br />
                  Original Name: Fireball Jutsu
                  <br />
                  Reskin Name: Blazing Verdict
                  <br />
                  Original Description: A sphere of fire launched at the target.
                  <br />
                  Reskin Description: A judgment cast in searing flame, leaving no room
                  for appeal.
                  <br />
                  Original Battle Description: %user hurls a fireball at %target.
                  <br />
                  Reskin Battle Description: %user delivers the Blazing Verdict to
                  %target, flames roaring with finality.
                  <br />
                  <br />
                  <strong>Note:</strong> Violation of these rules may result in the
                  modification or removal of the reskinned jutsu.
                </div>
              </div>
            </div>
          </Modal2>
        )}
        {isConfirmOpen && reskinData && userjutsu && (
          <Modal2
            isOpen={isConfirmOpen}
            setIsOpen={setIsConfirmOpen}
            title={
              userjutsu.activeReskin
                ? "Confirm Jutsu Reskin Update"
                : "Confirm Jutsu Reskin"
            }
            proceed_label={"Confirm"}
            onAccept={() => {
              if (reskinData && userjutsu) {
                reskin(reskinData);
                setIsConfirmOpen(false);
              }
            }}
          >
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                By clicking &quot;Confirm&quot;, you acknowledge that you are{" "}
                {userjutsu.activeReskin ? "updating" : "creating"} a reskin{" "}
                {userjutsu.activeReskin
                  ? ""
                  : `that costs ${reskinCost} reputation points`}{" "}
                and that your reskin follows all the outlined rules.
                <br />
                <br />
                <strong>Note:</strong> Violations may result in the modification or
                removal of your reskin.
              </p>
            </div>
          </Modal2>
        )}
      </ContentBox>
      {/* Free Transfer Timer */}
      {freeTransferResetTime &&
        freeTransferResetTime > new Date() &&
        usedTransfers > 0 && (
          <ContentBox
            title="Free Transfer Status"
            subtitle="Free transfers will reset"
            initialBreak={true}
          >
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">
                You have used {usedTransfers}/{freeTransfers} free transfers.
                {usedTransfers >= freeTransfers &&
                  " You must wait for transfers to reset or pay reputation points."}
              </p>
              <p className="text-lg font-semibold">
                Next free transfer available:{" "}
                <Countdown targetDate={freeTransferResetTime} />
              </p>
            </div>
          </ContentBox>
        )}
    </>
  );
}
