"use client";

import { parseHtml } from "@/utils/parse";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Confirm2 from "@/layout/Confirm2";
import RichInput from "@/layout/RichInput";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { prettyNumber } from "@/utils/string";
import { mutateContentSchema } from "@/validators/comments";
import { DoorOpen, Pencil, MapPinHouse } from "lucide-react";
import { Users, BrickWall, Bot, ReceiptJapaneseYen } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { useRequireInVillage } from "@/utils/UserContext";
import { hasRequiredRank } from "@/libs/train";

import {
  VILLAGE_REDUCED_GAINS_DAYS,
  VILLAGE_LEAVE_REQUIRED_RANK,
  WAR_VILLAGE_MAX_SECTORS,
  WAR_FACTION_MAX_SECTORS,
} from "@/drizzle/constants";

import Building, { StructureRewardEntries } from "@/layout/Building";
import { useTutorialStep } from "@/hooks/tutorial";
import type { MutateContentSchema } from "@/validators/comments";

export default function VillageOverview() {
  // State
  const { userData, sectorVillage } = useRequireInVillage();
  const { currentStep } = useTutorialStep();

  // Queries
  const { data, isFetching: isFetchingVillage } = api.village.get.useQuery(
    { id: sectorVillage?.id ?? "" },
    { enabled: !!sectorVillage },
  );

  // tRPC utility
  const utils = api.useUtils();

  // Derived
  const villageData = data?.villageData;
  const ownSector = userData?.village?.sector === sectorVillage?.sector;
  const notice = villageData?.notice?.content ?? "No notice at this point";
  const isKage = villageData?.kageId === userData?.userId;
  const title = villageData
    ? `${villageData.name}`
    : userData?.isOutlaw
      ? "Faction"
      : "Village";
  const subtitle = ownSector ? "Your Community" : `Ally of ${userData?.village?.name}`;
  const href = villageData ? `/users/village/${villageData.id}` : "/users";

  // Determine sector cap
  const maxSectors = userData?.isOutlaw
    ? WAR_FACTION_MAX_SECTORS
    : WAR_VILLAGE_MAX_SECTORS;

  // Specific structures
  const walls = villageData?.structures.find((s) => s.name === "Walls");
  const protectors = villageData?.structures.find((s) => s.name === "Protectors");

  // Mutations
  const { mutate: upsertNotice, isPending: isUpdating } =
    api.kage.upsertNotice.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.get.invalidate();
        }
      },
    });

  const { mutate: leaveVillage, isPending: isLeaving } =
    api.village.leaveVillage.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  // Form control
  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MutateContentSchema>({
    defaultValues: { content: notice },
    resolver: zodResolver(mutateContentSchema),
  });

  // Handling submit
  const onSubmit = handleSubmit((data) => {
    upsertNotice(data);
    reset();
  });

  // Loading states
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!villageData) return <Loader explanation="Loading userdata" />;
  if (isLeaving) return <Loader explanation="Leaving village" />;

  villageData.tokens = userData.isOutlaw
    ? userData.clan?.points || 0
    : villageData.tokens;

  const canLeave = hasRequiredRank(userData.rank, VILLAGE_LEAVE_REQUIRED_RANK);

  const shownStructures = villageData?.structures
    .filter((s) => s.hasPage !== 0)
    .filter((s) => s.showInVillagePage)
    .filter((s) => ownSector || s.allyAccess)
    .sort((a, v) => {
      if (a.name === currentStep?.title) return -1;
      if (v.name === currentStep?.title) return 1;
      return 0;
    });

  return (
    <>
      <ContentBox
        title={title}
        subtitle={subtitle}
        topRightContent={
          <div className="flex flex-row items-center">
            <div className="grid grid-cols-3 gap-1">
              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-row">
                      <MapPinHouse className="w-6 h-6 mr-2" />
                      {data?.sectorCount ?? "?"} / {maxSectors}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    Number of sectors owned (max {maxSectors})
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-row">
                      <BrickWall className="w-6 h-6 mr-2" /> lvl. {walls?.level}
                    </div>
                  </TooltipTrigger>
                  {walls && (
                    <TooltipContent>{StructureRewardEntries(walls)}</TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-row">
                      <Bot className="w-6 h-6 mr-2" /> lvl. {protectors?.level}
                    </div>
                  </TooltipTrigger>
                  {protectors && (
                    <TooltipContent>
                      {StructureRewardEntries(protectors)}
                    </TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger>
                    <Link href={href}>
                      <div className="flex flex-row hover:text-orange-500 hover:cursor-pointer">
                        <Users className="w-6 h-6 mr-2" />
                        {prettyNumber(villageData?.populationCount ?? 0)}
                      </div>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    Total {userData?.isOutlaw ? "faction" : "village"} population
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-row">
                      <ReceiptJapaneseYen className="w-6 h-6 mr-2" />
                      {prettyNumber(villageData?.tokens ?? 0)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    Tokens earned through PvP and quests can be used to improve{" "}
                    {userData?.isOutlaw ? "faction" : "village"}.
                    Current tokens: {villageData?.tokens.toLocaleString()}.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {!userData.isOutlaw && canLeave && ownSector && (
              <Confirm2
                title="Leave Village"
                proceed_label="Submit"
                button={
                  <Button className="ml-2">
                    <DoorOpen className="h-6 w-6" />
                  </Button>
                }
                onAccept={() => leaveVillage()}
              >
                Do you confirm that you wish to leave your{" "}
                {userData?.isOutlaw ? "faction" : "village"}? Your prestige will be
                reset to 0. Please be aware that if you join another{" "}
                {userData?.isOutlaw ? "faction" : "village"} your training benefits &
                regen will be reduced for {VILLAGE_REDUCED_GAINS_DAYS} days.
              </Confirm2>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-3 items-center sm:grid-cols-4">
          {shownStructures?.map((structure, i) => (
            <div
              key={i}
              className="p-2"
              id={`tutorial-${structure.route.replace("/", "")}`}
            >
              <Building
                structure={structure}
                village={villageData}
                key={structure.id}
                textPosition="bottom"
                showBar
                showUpgrade
              />
            </div>
          ))}
        </div>
        {isFetchingVillage && <Loader explanation="Loading Village Information" />}
      </ContentBox>

      {["OUTLAW", "VILLAGE"].includes(sectorVillage?.type || "unknown") && (
        <ContentBox
          title="Notice Board"
          subtitle={`Information from ${
            sectorVillage?.type === "OUTLAW" ? "Leader" : "Kage"
          }`}
          initialBreak={true}
          topRightContent={
            isKage && (
              <Confirm2
                title="Update Notice"
                proceed_label="Submit"
                button={
                  <Button id="create">
                    <Pencil className="h-6 w-6" />
                  </Button>
                }
                onAccept={onSubmit}
              >
                <RichInput
                  id="content"
                  label="Contents of your thread"
                  height="300"
                  placeholder={notice}
                  control={control}
                  error={errors.content?.message}
                />
              </Confirm2>
            )
          }
        >
          {parseHtml(notice)}
          {(isFetchingVillage || isUpdating) && (
            <Loader explanation="Loading Village Information" />
          )}
        </ContentBox>
      )}
    </>
  );
}