"use client";

import { useAtom, useAtomValue } from "jotai";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ignoreToastInteractions } from "@/components/ui/outside-interaction";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import Loader from "@/layout/Loader";
import { hasTutorialReminder } from "@/layout/TutorialSettings";
import {
  chatMentionsAtom,
  chatPanelAtom,
  countChatNotifications,
  getInboxNews,
} from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
import { useUserData } from "@/utils/UserContext";

/**
 * The button sits in every layout, so the panel's conversation, editor and AI code
 * load only when the panel first opens, keeping them out of every page's initial JS.
 */
const ChatPanelBody = dynamic(() => import("@/layout/ChatPanelContent"), {
  ssr: false,
  loading: () => <Loader explanation="Loading chat" />,
});

/**
 * Floating chat for signed-in players: taverns, private messages and Seichi AI in
 * one panel. Desktop shows a popover; phones show it full screen. Conversations
 * only subscribe to live updates while the panel shows them.
 */
export function ChatPanel({ children, className }: ChatPanelProps) {
  const { data: userData, notifications } = useUserData();
  const [panel, setPanel] = useAtom(chatPanelAtom);
  const mentions = useAtomValue(chatMentionsAtom);
  const isPhone = useMediaQuery("(max-width: 639px)");
  const [isWide, setIsWide] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = panel.owner === id;

  const badge = countChatNotifications(userData, getInboxNews(notifications), mentions);
  const showReminder = hasTutorialReminder(userData);
  const setOpen = (next: boolean) =>
    setPanel((current) => ({
      ...current,
      owner: next ? id : current.owner === id ? null : current.owner,
    }));

  // The first visible chat button answers requests to open the panel.
  useEffect(() => {
    if (!panel.openRequested || !triggerRef.current?.getClientRects().length) return;
    setPanel((current) =>
      current.openRequested ? { ...current, openRequested: false, owner: id } : current,
    );
  }, [panel.openRequested, id, setPanel]);
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
            align="end"
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
