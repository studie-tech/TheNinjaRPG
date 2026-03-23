"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRightLeft,
  ChevronsDown,
  CircleFadingArrowUp,
  OctagonX,
  Palette,
  SquareChevronLeft,
  SquareChevronRight,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ElementName } from "@/drizzle/constants";
import {
  COST_EXTRA_JUTSU_SLOT,
  COST_RESKIN_JUTSU,
  JUTSU_TRANSFER_COST,
  JUTSU_TRANSFER_DAYS,
  JUTSU_TRANSFER_MAX_LEVEL,
  JUTSU_TRANSFER_MINIMUM_LEVEL,
  JUTSU_XP_TO_LEVEL,
  MAX_EXTRA_JUTSU_SLOTS,
  RESKIN_LIMIT,
} from "@/drizzle/constants";
import type { UserItemWithItem, UserJutsuWithRelations } from "@/drizzle/schema";
import AvatarImage from "@/layout/Avatar";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuFiltering, { getFilter, useFiltering } from "@/layout/JutsuFiltering";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import { getFreeTransfers } from "@/libs/jutsu";
import { showUserRank } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import {
  calcJutsuEquipLimit,
  canEvolveJutsu,
  checkJutsuBloodline,
  checkJutsuElements,
  checkJutsuItems,
  checkJutsuRank,
  checkJutsuVillage,
  hasRequiredLevel,
  hasRequiredRank,
} from "@/libs/train";
import { canReskinFreely, canTransferJutsu } from "@/utils/permissions";
import { DAY_S, secondsFromDate } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import { UploadButton } from "@/utils/uploadthing";
import type { JutsuReskinCreateSchema } from "@/validators/jutsu";
import { jutsuReskinCreateSchema } from "@/validators/jutsu";
import { getUserElements } from "@/validators/user";

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

  // Accordion state for jutsu category sections (multiple can be open simultaneously)
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["bloodline", "pvpOnly", "pveOnly", "general"]),
  );

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

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

  // Watch reskin image for React Compiler compatibility
  const watchedReskinImage = useWatch({
    control: reskinForm.control,
    name: "image",
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

  const { mutate: evolveJutsu, isPending: isEvolving } =
    api.jutsu.evolveJutsu.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.jutsu.getUserJutsus.invalidate(),
            utils.jutsu.getEvolutions.invalidate(),
            utils.profile.getUser.invalidate(),
          ]);
          setIsOpen(false);
          setUserJutsu(undefined);
        }
      },
    });

  const { data: availableEvolutions } = api.jutsu.getEvolutions.useQuery(
    { jutsuId: userjutsu?.jutsuId ?? "" },
    { enabled: !!userjutsu },
  );

  const isPending =
    isToggling ||
    isForgetting ||
    isUpgrading ||
    isUnequipping ||
    isTransferring ||
    isReskinning ||
    isRemovingReskin ||
    isEvolving;
  const isFetching = l1 || l2;

  // Collapse UserItem and Item
  const userElements = useMemo(() => new Set(getUserElements(userData)), [userData]);

  // Categorize jutsu for organized display
  const categorizedJutsus = useMemo(() => {
    if (!userData) return null;
    return categorizeJutsus(userJutsus, userData, userItems, userElements);
  }, [userJutsus, userData, userItems, userElements]);

  // Transform jutsu to action items with warnings
  const transformToActionItems = useCallback(
    (jutsus: UserJutsuWithRelations[]) => {
      return jutsus.map((uj) => {
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
    },
    [userData, userItems, userElements],
  );

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
          <Button onClick={() => unequipAll()} disabled={isUnequipping}>
            <OctagonX className="mr-2 h-6 w-6" />
            {isUnequipping ? "Unequipping..." : "Unequip All"}
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

        {/* Equipped Section - Always Visible */}
        {categorizedJutsus && (
          <div className="mb-4">
            <h3 className="px-3 py-2 font-bold text-lg">
              Equipped Jutsu ({categorizedJutsus.equipped.length}/{maxEquip})
            </h3>
            <ActionSelector
              items={transformToActionItems(
                // Sort equipped by loadout order
                [...categorizedJutsus.equipped].sort((a, b) => {
                  const aIndex = userData?.loadout?.jutsuIds.indexOf(a.jutsuId) ?? -1;
                  const bIndex = userData?.loadout?.jutsuIds.indexOf(b.jutsuId) ?? -1;
                  if (aIndex === -1 && bIndex === -1) return 0;
                  if (aIndex === -1) return 1;
                  if (bIndex === -1) return -1;
                  return aIndex - bIndex;
                }),
              )}
              counts={userJutsuCounts?.filter((c) =>
                categorizedJutsus.equipped.some((j) => j.id === c.id),
              )}
              labelSingles={true}
              onClick={(id) => {
                setUserJutsu(userJutsus?.find((uj) => uj.id === id));
                setIsOpen(true);
              }}
              showBgColor={false}
              showLabels={true}
              emptyText="No jutsu equipped. Select jutsu from the categories below to equip."
            />
          </div>
        )}

        {/* Accordion Sections for Non-Equipped Jutsu */}
        {categorizedJutsus && (
          <div>
            <JutsuCategorySection
              title="Bloodline Jutsu"
              jutsus={categorizedJutsus.bloodline}
              isOpen={openSections.has("bloodline")}
              onToggle={() => toggleSection("bloodline")}
              onClick={(id) => {
                setUserJutsu(userJutsus?.find((uj) => uj.id === id));
                setIsOpen(true);
              }}
              counts={userJutsuCounts}
              transformToActionItems={transformToActionItems}
            />
            <JutsuCategorySection
              title="PVP Jutsu"
              jutsus={categorizedJutsus.pvpOnly}
              isOpen={openSections.has("pvpOnly")}
              onToggle={() => toggleSection("pvpOnly")}
              onClick={(id) => {
                setUserJutsu(userJutsus?.find((uj) => uj.id === id));
                setIsOpen(true);
              }}
              counts={userJutsuCounts}
              transformToActionItems={transformToActionItems}
            />
            <JutsuCategorySection
              title="PVE Jutsu"
              jutsus={categorizedJutsus.pveOnly}
              isOpen={openSections.has("pveOnly")}
              onToggle={() => toggleSection("pveOnly")}
              onClick={(id) => {
                setUserJutsu(userJutsus?.find((uj) => uj.id === id));
                setIsOpen(true);
              }}
              counts={userJutsuCounts}
              transformToActionItems={transformToActionItems}
            />
            <JutsuCategorySection
              title="General Jutsu"
              jutsus={categorizedJutsus.general}
              isOpen={openSections.has("general")}
              onToggle={() => toggleSection("general")}
              onClick={(id) => {
                setUserJutsu(userJutsus?.find((uj) => uj.id === id));
                setIsOpen(true);
              }}
              counts={userJutsuCounts}
              transformToActionItems={transformToActionItems}
            />
            <JutsuCategorySection
              title="Unavailable Jutsu"
              jutsus={categorizedJutsus.unavailable}
              isOpen={openSections.has("unavailable")}
              onToggle={() => toggleSection("unavailable")}
              onClick={(id) => {
                setUserJutsu(userJutsus?.find((uj) => uj.id === id));
                setIsOpen(true);
              }}
              counts={userJutsuCounts}
              transformToActionItems={transformToActionItems}
            />
          </div>
        )}

        {/* Show message when no jutsu */}
        {!isFetching &&
          categorizedJutsus &&
          Object.values(categorizedJutsus).every((arr) => arr.length === 0) && (
            <p className="py-4 text-center text-muted-foreground">
              You have not learned any jutsu. Go to the training grounds in your village
              to learn some.
            </p>
          )}

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
                    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2">
                      <p className="text-blue-700 text-sm">
                        <Palette className="mr-1 inline h-4 w-4" />
                        This jutsu has been previously reskinned. You can create a new
                        reskin for free.
                      </p>
                    </div>
                  )}
                <div className="flex flex-row items-center gap-3">
                  {userData.loadout?.jutsuIds.includes(userjutsu.jutsuId) && (
                    <>
                      <SquareChevronLeft
                        className="h-8 w-8 hover:cursor-pointer hover:text-orange-300"
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
                        className="h-8 w-8 hover:cursor-pointer hover:text-orange-300"
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
                                  setTransferValue(parseInt(e.target.value, 10) || 1)
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
                              {transferValue} level
                              {transferValue > 1 ? "s" : ""} to{" "}
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
                  {availableEvolutions &&
                    availableEvolutions.length > 0 &&
                    availableEvolutions.map((evo) => (
                      <Confirm2
                        key={evo.id}
                        title={`Evolve to ${evo.name}`}
                        button={
                          <Button
                            id={`evolve-${evo.id}`}
                            variant="secondary"
                            disabled={
                              isPending ||
                              !userData ||
                              !canEvolveJutsu(evo, userData) ||
                              !hasRequiredRank(userData.rank, evo.requiredRank) ||
                              !hasRequiredLevel(userData.level, evo.requiredLevel)
                            }
                          >
                            <CircleFadingArrowUp className="h-6 w-6 sm:mr-2" />
                            <p className="hidden sm:block">Evolve</p>
                          </Button>
                        }
                        onAccept={(e) => {
                          e.preventDefault();
                          evolveJutsu({
                            userJutsuId: userjutsu.id,
                            evolutionJutsuId: evo.id,
                          });
                        }}
                      >
                        <p>
                          Evolve <b>{userjutsu.jutsu.name}</b> into <b>{evo.name}</b>?
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          This will replace your current jutsu. The evolved jutsu starts
                          at level 1.
                        </p>
                        {evo.requiredRank && (
                          <p className="text-sm">
                            Required Rank:{" "}
                            <b>
                              {showUserRank({
                                rank: evo.requiredRank,
                                isOutlaw: userData?.isOutlaw,
                              })}
                            </b>
                          </p>
                        )}
                        {evo.requiredLevel > 1 && (
                          <p className="text-sm">
                            Required Level: <b>{evo.requiredLevel}</b>
                          </p>
                        )}
                        {(
                          [
                            ["requiredNinjutsuOffence", "Ninjutsu Offence"],
                            ["requiredNinjutsuDefence", "Ninjutsu Defence"],
                            ["requiredTaijutsuOffence", "Taijutsu Offence"],
                            ["requiredTaijutsuDefence", "Taijutsu Defence"],
                            ["requiredGenjutsuOffence", "Genjutsu Offence"],
                            ["requiredGenjutsuDefence", "Genjutsu Defence"],
                            ["requiredBukijutsuOffence", "Bukijutsu Offence"],
                            ["requiredBukijutsuDefence", "Bukijutsu Defence"],
                            ["requiredStrength", "Strength"],
                            ["requiredSpeed", "Speed"],
                            ["requiredIntelligence", "Intelligence"],
                            ["requiredWillpower", "Willpower"],
                          ] as const
                        )
                          .filter(([key]) => evo[key] != null)
                          .map(([key, label]) => (
                            <p key={key} className="text-sm">
                              Required {label}: <b>{evo[key]}</b>
                            </p>
                          ))}
                      </Confirm2>
                    ))}
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
            className="max-h-[99%] w-[800px] max-w-[99%]"
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
                  className="grid grid-cols-3 gap-4 space-y-4"
                >
                  <div className="row-span-3 space-y-2">
                    <p className="text-muted-foreground text-sm">
                      Optional: upload a new image for this reskin
                    </p>
                    <div className="flex flex-col items-center gap-3">
                      <AvatarImage
                        href={watchedReskinImage || userjutsu.jutsu.image}
                        alt={userjutsu.jutsu.name}
                        size={64}
                        hover_effect={false}
                      />
                      <UploadButton
                        endpoint="imageUploader"
                        onClientUploadComplete={(res) => {
                          const url = res?.[0]?.url;
                          if (url) {
                            reskinForm.setValue("image", url, {
                              shouldValidate: true,
                            });
                          }
                        }}
                        onUploadError={(error: Error) => {
                          showMutationToast({
                            success: false,
                            message: error.message,
                          });
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
                  <br />- Jutsu Name
                  <br />- Jutsu Description (what shows outside of combat)
                  <br />- Battle Description (what appears in combat, e.g., &quot;%user
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
                  <br />- No hostile, mocking, or negative wording toward other players,
                  clans, villages, bloodlines, or jutsu.
                  <br />- No profanity, slurs, or real-world political/religious
                  references.
                  <br />- No inappropriate humor or immersion-breaking language.
                  <br />- No subtle digs or sarcasm aimed at others. If it could be
                  taken negatively, it&apos;s not allowed.
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
              <p className="text-muted-foreground text-sm">
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
            <div className="space-y-2 text-center">
              <p className="text-muted-foreground">
                You have used {usedTransfers}/{freeTransfers} free transfers.
                {usedTransfers >= freeTransfers &&
                  " You must wait for transfers to reset or pay reputation points."}
              </p>
              <p className="font-semibold text-lg">
                Next free transfer available:{" "}
                <Countdown targetDate={freeTransferResetTime} />
              </p>
            </div>
          </ContentBox>
        )}
    </>
  );
}

// Sub-component for rendering accordion-style jutsu category sections
interface JutsuCategorySectionProps {
  title: string;
  jutsus: UserJutsuWithRelations[];
  isOpen: boolean;
  onToggle: () => void;
  onClick: (id: string) => void;
  counts: { id: string; quantity: number }[] | undefined;
  transformToActionItems: (jutsus: UserJutsuWithRelations[]) => {
    id: string;
    name: string;
    image: string;
    type: "jutsu";
    highlight: boolean;
    warning: string;
    isReskinned: boolean;
  }[];
}

const JutsuCategorySection = memo((props: JutsuCategorySectionProps) => {
  const { title, jutsus, isOpen, onToggle, onClick, counts, transformToActionItems } =
    props;
  if (jutsus.length === 0) return null;

  return (
    <div className="border-b-2 px-3 py-1">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-row items-center hover:bg-popover"
        onClick={onToggle}
      >
        <h2 className="mt-2 font-bold">
          {title} ({jutsus.length})
        </h2>
        <div className="grow"></div>
        <ChevronsDown
          className={`h-6 w-6 hover:text-orange-500 ${isOpen ? "rotate-180 transform" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="py-2">
          <ActionSelector
            items={transformToActionItems(jutsus)}
            counts={counts?.filter((c) => jutsus.some((j) => j.id === c.id))}
            labelSingles={true}
            onClick={onClick}
            showBgColor={false}
            showLabels={true}
          />
        </div>
      )}
    </div>
  );
});
JutsuCategorySection.displayName = "JutsuCategorySection";

// Helper types and functions

// Categorization types for organizing jutsu by usage type
interface CategorizedJutsus {
  equipped: UserJutsuWithRelations[];
  bloodline: UserJutsuWithRelations[];
  pvpOnly: UserJutsuWithRelations[];
  pveOnly: UserJutsuWithRelations[];
  general: UserJutsuWithRelations[];
  unavailable: UserJutsuWithRelations[];
}

// Categorizes user jutsu into sections based on equipped status, bloodline, and battle usage type
const categorizeJutsus = (
  userJutsus: UserJutsuWithRelations[] | undefined,
  userData: {
    rank: string;
    level: number;
    villageId: string | null;
    bloodlineId: string | null;
    isOutlaw: boolean;
  },
  userItems: UserItemWithItem[] | undefined,
  userElements: Set<ElementName>,
): CategorizedJutsus => {
  const result: CategorizedJutsus = {
    equipped: [],
    bloodline: [],
    pvpOnly: [],
    pveOnly: [],
    general: [],
    unavailable: [],
  };

  if (!userJutsus) return result;

  for (const uj of userJutsus) {
    // Equipped jutsu go to their own section
    if (uj.equipped) {
      result.equipped.push(uj);
      continue;
    }

    // Check if user can equip this jutsu
    const canEquipJutsu =
      checkJutsuItems(uj.jutsu, userItems) &&
      checkJutsuElements(uj.jutsu, userElements) &&
      hasRequiredRank(
        userData.rank as Parameters<typeof hasRequiredRank>[0],
        uj.jutsu.requiredRank,
      ) &&
      hasRequiredLevel(userData.level, uj.jutsu.requiredLevel) &&
      checkJutsuRank(
        uj.jutsu.jutsuRank,
        userData.rank as Parameters<typeof checkJutsuRank>[1],
      ) &&
      checkJutsuVillage(
        uj.jutsu,
        userData as Parameters<typeof checkJutsuVillage>[1],
      ) &&
      checkJutsuBloodline(
        uj.jutsu,
        userData as Parameters<typeof checkJutsuBloodline>[1],
      );

    if (!canEquipJutsu) {
      result.unavailable.push(uj);
      continue;
    }

    // Bloodline jutsu have priority category
    if (uj.jutsu.jutsuType === "BLOODLINE") {
      result.bloodline.push(uj);
    } else if (uj.jutsu.battleUsageType === "PVP") {
      result.pvpOnly.push(uj);
    } else if (uj.jutsu.battleUsageType === "PVE") {
      result.pveOnly.push(uj);
    } else {
      // battleUsageType === "BOTH" or default
      result.general.push(uj);
    }
  }

  return result;
};
