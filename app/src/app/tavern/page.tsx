"use client";

import { useEffect, useMemo } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import NavTabs from "@/layout/NavTabs";
import Conversation, { ConversationSkeleton } from "@/layout/Conversation";
import BanInfo from "@/layout/BanInfo";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserRoundX } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/app/_trpc/client";
import { findVillageUserRelationship } from "@/utils/alliance";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Tavern() {
  // State
  const [activeTab, setActiveTab] = useLocalStorage<string | undefined>(
    "selectedTavern2",
    undefined,
  );

  // Data
  const { data: userData } = useRequiredUserData();
  const { data: villages } = api.village.getAll.useQuery(undefined, {
    enabled: !!userData,
  });
  const { data: sectorVillage, isPending } = api.travel.getVillageInSector.useQuery(
    { sector: userData?.sector ?? -1, isOutlaw: userData?.isOutlaw ?? false },
    { enabled: !!userData },
  );
  const { data: globalTavernEnabled = true, isPending: isLoadingGlobalTavern } =
    api.misc.getGlobalTavernEnabled.useQuery();

  // Tavern name based on user village
  const localTavern = useMemo(() => {
    let tavern =
      ["OUTLAW", "TOWN", "VILLAGE"].includes(userData?.village?.type ?? "") &&
      userData?.village?.name
        ? userData?.village?.name
        : "Syndicate";

    // Change to ally tavern if relevant
    if (sectorVillage && userData) {
      const relationship = findVillageUserRelationship(
        sectorVillage,
        userData.villageId ?? "syndicate",
      );
      if (relationship?.status === "ALLY") {
        tavern = sectorVillage.name;
      }
    }
    return tavern;
  }, [userData, sectorVillage]);

  // Check if user can access global tavern (enabled OR non-USER role)
  const canAccessGlobal = globalTavernEnabled || userData?.role !== "USER";

  // Check available taverns
  const availTaverns = canAccessGlobal ? ["Global", localTavern] : [localTavern];
  if (userData?.role !== "USER") {
    villages
      ?.filter((v) => ["OUTLAW", "VILLAGE"].includes(v.type))
      .map((v) => v.name)
      .filter((v) => !availTaverns.includes(v))
      .forEach((v) => availTaverns.push(v));
  }

  // If no tavern defined, set the tavern
  useEffect(() => {
    if (userData && !activeTab) {
      setActiveTab(canAccessGlobal ? "Global" : localTavern);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, localTavern, canAccessGlobal]);

  // Redirect to village tavern if global is disabled and user is on Global (only for USER role)
  useEffect(() => {
    if (
      userData &&
      userData.role === "USER" &&
      !globalTavernEnabled &&
      activeTab === "Global"
    ) {
      setActiveTab(localTavern);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, globalTavernEnabled, activeTab, localTavern]);

  // Derived
  const conversation = activeTab ?? (canAccessGlobal ? "Global" : localTavern);
  const convoProps = {
    refreshKey: 0,
    title: conversation + " Tavern",
    initialBreak: false,
    subtitle: conversation === "Global" ? "Global chat" : "Village chat",
  };

  // Blockers
  if (!userData || isPending || isLoadingGlobalTavern) {
    return <ConversationSkeleton {...convoProps} />;
  }
  if (userData.isBanned || userData.isSilenced) return <BanInfo />;

  // Tavern selector
  const tavernSelector =
    userData?.role !== "USER" ? (
      <Select onValueChange={(e) => setActiveTab(e)}>
        <SelectTrigger>
          <SelectValue placeholder={activeTab} />
        </SelectTrigger>
        <SelectContent>
          {availTaverns?.map((village) => (
            <SelectItem key={village} value={village}>
              {village}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <NavTabs
        id="tavernSelector"
        current={activeTab ?? localTavern}
        options={availTaverns}
        setValue={setActiveTab}
      />
    );

  return (
    <Conversation
      {...convoProps}
      convo_title={conversation}
      topRightContent={
        <div className="flex flex-row gap-1">
          {tavernSelector}
          <Popover>
            <PopoverTrigger asChild>
              <Button id="filter-bloodline">
                <UserRoundX className="h-6 w-6 hover:text-orange-500" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0 overflow-hidden">
              <UserBlacklistControl />
            </PopoverContent>
          </Popover>
        </div>
      }
    />
  );
}
