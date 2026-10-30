"use client";

import { UserRoundX } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTaverns } from "@/hooks/useTaverns";
import BanInfo from "@/layout/BanInfo";
import Conversation, { ConversationSkeleton } from "@/layout/Conversation";
import NavTabs from "@/layout/NavTabs";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import { useRequiredUserData } from "@/utils/UserContext";

export default function Tavern() {
  // State
  const [activeTab, setActiveTab] = useLocalStorage<string | undefined>(
    "selectedTavern2",
    undefined,
  );

  // Data
  const { data: userData } = useRequiredUserData();
  const {
    availTaverns,
    localTavern,
    canAccessGlobal,
    globalTavernEnabled,
    isLoading: isLoadingTaverns,
  } = useTaverns(userData);

  // If no tavern defined, set the tavern
  useEffect(() => {
    if (userData && !activeTab) {
      setActiveTab(canAccessGlobal ? "Global" : localTavern);
    }
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
  }, [userData, globalTavernEnabled, activeTab, localTavern]);

  // Derived
  const conversation = activeTab ?? (canAccessGlobal ? "Global" : localTavern);
  const convoProps = {
    refreshKey: 0,
    title: `${conversation} Tavern`,
    initialBreak: false,
    subtitle: conversation === "Global" ? "Global chat" : "Village chat",
  };

  // Blockers
  if (!userData || isLoadingTaverns) {
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
          {availTaverns?.map((village, i) => (
            <SelectItem key={`${village}-${i}`} value={village}>
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
      tavernStyling
      topRightContent={
        <div className="flex flex-row gap-1">
          {tavernSelector}
          <Popover>
            <PopoverTrigger asChild>
              <Button id="filter-bloodline">
                <UserRoundX className="h-6 w-6 hover:text-orange-500" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] overflow-hidden p-0">
              <UserBlacklistControl />
            </PopoverContent>
          </Popover>
        </div>
      }
    />
  );
}
