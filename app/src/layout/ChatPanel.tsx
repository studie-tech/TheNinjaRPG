"use client";

import { useAtom, useAtomValue } from "jotai";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ignoreToastInteractions } from "@/components/ui/outside-interaction";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import { useActivityDock } from "@/hooks/useActivityDock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import Loader from "@/layout/Loader";
import { hasTutorialReminder } from "@/layout/TutorialSettings";
import {
  CHAT_PANEL_PHONE_MEDIA_QUERY,
  chatMentionsAtom,
  chatPanelAtom,
  chatTavernActivityAtom,
  countChatNotifications,
  getInboxNews,
} from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * The button sits in every layout, so the panel's conversation, editor and AI code
 * load only when the panel first opens, keeping them out of every page's initial JS.
 */
const ChatPanelBody = dynamic(() => import("@/layout/ChatPanelContent"), {
  ssr: false,
  loading: () => <Loader explanation="Loading chat" />,
});

/**
 * Floating chat for players who meet the messaging level requirement: taverns,
 * private messages and Seichi AI. Desktop shows a popover; phones show it full
 * screen. Conversations only subscribe to live updates while the panel shows them.
 */
export function ChatPanel({ children, className }: ChatPanelProps) {
  const { data: userData, notifications } = useUserDataSelector(selectChatPanelUser);
  const [panel, setPanel] = useAtom(chatPanelAtom);
  const mentions = useAtomValue(chatMentionsAtom);
  const tavernActivity = useAtomValue(chatTavernActivityAtom);
  const isPhone = useMediaQuery(CHAT_PANEL_PHONE_MEDIA_QUERY);
  const [isWide, setIsWide] = useState(false);
  const { swapSides } = useActivityDock();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canUseChat = !!userData && userData.level >= MESSAGING_MIN_LEVEL;
  const open = canUseChat && panel.owner === id;

  const badge = countChatNotifications(
    userData,
    getInboxNews(notifications),
    mentions,
    tavernActivity,
  );
  const showReminder = hasTutorialReminder(userData);
  const setOpen = (next: boolean) =>
    setPanel((current) => ({
      ...current,
      owner: next ? id : current.owner === id ? null : current.owner,
    }));

  // The first visible chat button answers requests to open the panel.
  useEffect(() => {
    if (!canUseChat) {
      // Hidden chat must release Activity and discard requests for its unavailable launcher.
      setPanel((current) =>
        current.owner || current.openRequested
          ? { ...current, owner: null, openRequested: false }
          : current,
      );
      return;
    }
    if (!panel.openRequested || !triggerRef.current?.getClientRects().length) return;
    setPanel((current) =>
      current.openRequested ? { ...current, openRequested: false, owner: id } : current,
    );
  }, [canUseChat, panel.openRequested, id, setPanel]);
  if (!canUseChat) return null;

  const body = (
    <ChatPanelBody
      isPhone={isPhone}
      isWide={isWide}
      onToggleWide={() => setIsWide(!isWide)}
      onClose={() => setOpen(false)}
    />
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          ref={triggerRef}
          name="supportBtn"
          aria-label={badge > 0 ? `Chat, ${badge} unread` : "Chat"}
        >
          <div className={cn("relative", className)}>
            {children}
            {(badge > 0 || showReminder) && (
              <span className="absolute -top-[4px] -right-[4px] flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-red-500 px-[4px] text-[12px] text-white">
                {badge > 0 ? (badge > 99 ? "99+" : badge) : "!"}
              </span>
            )}
          </div>
        </PopoverTrigger>
        {open && !isPhone && (
          <PopoverContent
            side="top"
            align={swapSides ? "start" : "end"}
            collisionPadding={8}
            onInteractOutside={ignoreToastInteractions()}
            className={cn(
              "flex h-[min(560px,var(--radix-popover-content-available-height))] flex-col overflow-hidden p-0",
              isWide
                ? "w-[min(640px,calc(100vw-1rem))]"
                : "w-[min(380px,calc(100vw-1rem))]",
            )}
          >
            {body}
          </PopoverContent>
        )}
      </Popover>
      {isPhone && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              // The phone dialog opens from the sibling popover's trigger.
              const trigger = triggerRef.current;
              if (trigger?.isConnected && trigger.getClientRects().length) {
                event.preventDefault();
                trigger.focus();
              }
            }}
            className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0 sm:rounded-none"
          >
            <DialogTitle className="sr-only">Chat</DialogTitle>
            {body}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

interface ChatPanelProps {
  children: React.ReactNode;
  className?: string;
}

/** Keep panel eligibility and mute state reactive without subscribing to unrelated profile fields. */
const selectChatPanelUser = (user: NonNullable<UserWithRelations>) => ({
  level: user.level,
  tutorialOn: user.tutorialOn,
  userQuests: user.userQuests,
  chatMuted: user.chatMuted,
  mutedConversationIds: user.mutedConversationIds,
  unmutedTavernIds: user.unmutedTavernIds,
});
