"use client";

import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTavernIds } from "@/hooks/useTavernActivity";
import { useTaverns } from "@/hooks/useTaverns";
import BanInfo from "@/layout/BanInfo";
import { ChatMuteButton } from "@/layout/ChatMuteButton";
import Conversation, { ConversationSkeleton } from "@/layout/Conversation";
import NavTabs from "@/layout/NavTabs";
import { UserBlacklistPopover } from "@/layout/UserBlacklistControl";
import { useRequiredUserData } from "@/utils/UserContext";

/** Full tavern conversation with channel selection and account notification controls. */
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
  const tavernIds = useTavernIds(userData);

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

  // Derived: the selector and the conversation share this fallback.
  const defaultTavern = canAccessGlobal ? "Global" : localTavern;
  const conversation =
    !activeTab || (activeTab === "Global" && !canAccessGlobal)
      ? defaultTavern
      : activeTab;
  const tavernId = tavernIds?.find((tavern) => tavern.title === conversation)?.id;
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
          <SelectValue placeholder={conversation} />
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
        current={conversation}
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
          {tavernId && (
            <ChatMuteButton
              label={conversation}
              conversationId={tavernId}
              isTavern
              variant="default"
              size="default"
            />
          )}
          <UserBlacklistPopover />
        </div>
      }
    />
  );
}
