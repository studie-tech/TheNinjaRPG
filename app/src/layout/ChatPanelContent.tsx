"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  ExternalLink,
  LogOut,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
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
import { useChatMutes } from "@/hooks/useChatMutes";
import { useTaverns } from "@/hooks/useTaverns";
import AvatarImage from "@/layout/Avatar";
import BanInfo from "@/layout/BanInfo";
import { ChatConversation } from "@/layout/ChatConversation";
import Confirm from "@/layout/Confirm";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { NewConversationPrompt } from "@/layout/NewConversationPrompt";
import { hasTutorialReminder } from "@/layout/TutorialSettings";
import UserBlacklistControl from "@/layout/UserBlacklistControl";
import {
  type ChatStartUser,
  type ChatTab,
  chatMentionsAtom,
  chatPanelAtom,
  getInboxNews,
  isConversationUnread,
} from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/**
 * The AI SDK (`ai`, `@ai-sdk/react` and its swr dependency) loads only when the Ask
 * AI tab opens.
 */
const ChatBox = dynamic(() => import("@/layout/ChatBox"), {
  ssr: false,
  loading: () => <Loader explanation="Loading chat" />,
});

/** Tabs and content shared by the desktop popover and the phone screen. */
export default function ChatPanelBody({
  isPhone,
  isWide,
  onToggleWide,
  onClose,
}: {
  isPhone: boolean;
  isWide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
}) {
  const { data: userData, notifications } = useUserData();
  const [panel, setPanel] = useAtom(chatPanelAtom);
  const mentions = useAtomValue(chatMentionsAtom);
  const mutes = useChatMutes();
  // Phones show a list of chats first, then one conversation with a back button.
  const [phoneChat, setPhoneChat] = useState<PhoneChat | null>(null);

  const setTab = (tab: ChatTab) => setPanel((current) => ({ ...current, tab }));
  const openMessageWith = useCallback(
    (user: ChatStartUser) =>
      setPanel((current) => ({ ...current, tab: "inbox", startWith: user })),
    [setPanel],
  );

  // A request to message someone opens their conversation on phones too.
  useEffect(() => {
    if (isPhone && panel.tab === "inbox" && (panel.conversationId || panel.startWith)) {
      setPhoneChat({ kind: "inbox" });
    }
  }, [isPhone, panel.tab, panel.conversationId, panel.startWith]);

  if (!userData) return null;
  const inboxNews = mutes.chatMuted ? 0 : getInboxNews(notifications);
  const tavernMentions = mutes.chatMuted
    ? 0
    : Object.entries(mentions)
        .filter(([id]) => !mutes.isSilenced(id))
        .reduce((sum, [, count]) => sum + count, 0);
  const activeTab: ChatTab =
    isPhone && panel.tab !== "ai" ? (phoneChat ? phoneChat.kind : "tavern") : panel.tab;

  const tabs: { id: ChatTab; label: string; count?: number }[] = isPhone
    ? [
        { id: "tavern", label: "Chats", count: inboxNews + tavernMentions },
        { id: "ai", label: "Ask AI" },
      ]
    : [
        { id: "tavern", label: "Tavern", count: tavernMentions },
        { id: "inbox", label: "Inbox", count: inboxNews },
        { id: "ai", label: "Ask AI" },
      ];

  const showPhoneList = isPhone && panel.tab !== "ai" && !phoneChat;
  const backToList = () => {
    setPhoneChat(null);
    setPanel((current) => ({ ...current, tab: "tavern", startWith: undefined }));
  };

  return (
    <div className="bg-popover text-popover-foreground flex h-full min-h-0 flex-col">
      <header className="bg-muted/40 flex shrink-0 items-center gap-[4px] border-b px-[8px] py-[6px]">
        {isPhone && phoneChat && panel.tab !== "ai" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-[36px] gap-[4px] px-[8px]"
            onClick={backToList}
          >
            <ArrowLeft className="h-[16px] w-[16px]" aria-hidden />
            Chats
          </Button>
        ) : (
          <div
            role="tablist"
            aria-label="Chat"
            className="flex min-w-0 items-center gap-[4px]"
          >
            {tabs.map((tab) => {
              const selected = isPhone
                ? (tab.id === "ai") === (panel.tab === "ai")
                : tab.id === panel.tab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(tab.id)}
                  className={cn(
                    "flex h-[32px] items-center gap-[4px] rounded-md px-[10px] text-[13px]",
                    selected
                      ? "bg-background text-foreground font-semibold shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {!!tab.count && (
                    <span className="rounded-full bg-red-500 px-[6px] text-[11px] leading-4 text-white">
                      {tab.count > 99 ? "99+" : tab.count}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className="ml-auto flex items-center">
          {!isPhone && (
            <Button
              variant="ghost"
              size="icon"
              className="h-[32px] w-[32px]"
              aria-label={isWide ? "Make chat narrower" : "Make chat wider"}
              onClick={onToggleWide}
            >
              {isWide ? (
                <Minimize2 className="h-[16px] w-[16px]" />
              ) : (
                <Maximize2 className="h-[16px] w-[16px]" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-[32px] w-[32px]"
            aria-label="Close chat"
            onClick={onClose}
          >
            <X className="h-[16px] w-[16px]" />
          </Button>
        </div>
      </header>
      {hasTutorialReminder(userData) && (
        <Link
          href={`${SETTINGS_HREF}&settings=help&setting=tutorial`}
          onClick={onClose}
          className="flex shrink-0 items-start gap-[8px] border-b border-orange-500 bg-orange-500/10 px-[12px] py-[8px] text-[12px]"
        >
          <AlertCircle
            className="mt-[2px] h-[16px] w-[16px] shrink-0 text-orange-500"
            aria-hidden
          />
          <span>
            You have active quests and the tutorial is off.{" "}
            <span className="font-semibold text-orange-500 underline">
              Turn it on in Settings
            </span>
          </span>
        </Link>
      )}
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {activeTab === "ai" ? (
          <ChatBox
            className="min-h-0 flex-1"
            autoFocus={false}
            onAskTavern={() => setTab("tavern")}
          />
        ) : showPhoneList ? (
          <PhoneChatList onOpen={setPhoneChat} />
        ) : activeTab === "inbox" ? (
          <InboxPane hideRail={isPhone} onMessageUser={openMessageWith} />
        ) : (
          <TavernPane
            fixedTavern={phoneChat?.kind === "tavern" ? phoneChat.tavern : undefined}
            onMessageUser={openMessageWith}
          />
        )}
      </div>
    </div>
  );
}

/** Tavern conversation with a tavern switch, mute and more menu. */
function TavernPane({
  fixedTavern,
  onMessageUser,
}: {
  fixedTavern?: string;
  onMessageUser: (user: ChatStartUser) => void;
}) {
  const { data: userData } = useUserData();
  const { availTaverns, localTavern, canAccessGlobal, isLoading } =
    useTaverns(userData);
  // Shared with the tavern page, so both open the same tavern.
  const [selected, setSelected] = useLocalStorage<string | undefined>(
    "selectedTavern2",
    undefined,
  );
  const [conversationId, setConversationId] = useState<string>();
  const setMentions = useSetAtom(chatMentionsAtom);
  const mutes = useChatMutes();

  const onConversationLoaded = useCallback(
    (id: string) => {
      setConversationId(id);
      setMentions((current) => (current[id] ? { ...current, [id]: 0 } : current));
    },
    [setMentions],
  );

  if (!userData || isLoading) return <Loader explanation="Loading tavern" />;
  if (userData.isBanned || userData.isSilenced) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
        <BanInfo />
      </div>
    );
  }
  const tavern =
    fixedTavern ??
    (selected && availTaverns.includes(selected)
      ? selected
      : canAccessGlobal
        ? "Global"
        : localTavern);

  const tavernSwitch = fixedTavern ? (
    <span className="truncate px-[4px] text-[13px] font-semibold">{tavern} Tavern</span>
  ) : userData.role !== "USER" ? (
    <Select value={tavern} onValueChange={setSelected}>
      <SelectTrigger className="h-[32px] w-[160px]" aria-label="Tavern">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {availTaverns.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : (
    <fieldset className="bg-muted m-0 flex min-w-0 rounded-md border-0 p-[2px]">
      <legend className="sr-only">Tavern</legend>
      {availTaverns.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={name === tavern}
          onClick={() => setSelected(name)}
          className={cn(
            "h-[28px] rounded px-[10px] text-[12px]",
            name === tavern
              ? "bg-background font-semibold shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {name}
        </button>
      ))}
    </fieldset>
  );

  return (
    <ChatConversation
      key={tavern}
      convoTitle={tavern}
      placeholder={`Message ${tavern}…`}
      tavernStyling
      onConversationLoaded={onConversationLoaded}
      onMessageUser={onMessageUser}
      toolbarStart={tavernSwitch}
      toolbarEnd={
        <>
          {conversationId && (
            <MuteButton
              label={tavern}
              muted={mutes.isMuted(conversationId)}
              onToggle={() => mutes.toggleMute(conversationId)}
            />
          )}
          <TavernMoreMenu />
        </>
      }
    />
  );
}

/** Mute-all, blocked players and a link to the full tavern page. */
function TavernMoreMenu() {
  const [open, setOpen] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const mutes = useChatMutes();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setShowBlocked(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="w-[32px]"
          aria-label="More chat options"
        >
          <MoreHorizontal className="h-[16px] w-[16px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="w-[256px] p-[4px]">
        {showBlocked ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="mb-[4px] h-[32px] gap-[4px]"
              onClick={() => setShowBlocked(false)}
            >
              <ArrowLeft className="h-[16px] w-[16px]" aria-hidden /> Back
            </Button>
            <div className="max-h-[288px] overflow-y-auto">
              <UserBlacklistControl />
            </div>
          </div>
        ) : (
          <div role="menu" aria-label="More chat options">
            <MenuButton
              onClick={() => mutes.setChatMuted(!mutes.chatMuted)}
              disabled={mutes.isPending}
            >
              {mutes.chatMuted ? <Bell /> : <BellOff />}
              {mutes.chatMuted
                ? "Unmute all chat notifications"
                : "Mute all chat notifications"}
            </MenuButton>
            <MenuButton onClick={() => setShowBlocked(true)}>
              <Ban /> Blocked users
            </MenuButton>
            <Link
              href="/tavern"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={menuItemClass}
            >
              <ExternalLink /> Open full tavern page
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Private conversations: a rail of chats beside the open conversation. */
function InboxPane({
  hideRail,
  onMessageUser,
}: {
  hideRail: boolean;
  onMessageUser: (user: ChatStartUser) => void;
}) {
  const { data: userData, notifications, updateNotifications } = useUserData();
  const [panel, setPanel] = useAtom(chatPanelAtom);
  const mutes = useChatMutes();
  const { data: conversations, isPending } = api.comments.getUserConversations.useQuery(
    { selectedConvo: null },
    { enabled: !!userData },
  );

  // Listing conversations clears the server's inbox counter; mirror it locally.
  useEffect(() => {
    if (conversations && getInboxNews(notifications) > 0) {
      void updateNotifications(notifications?.filter((n) => n.href !== "/inbox"));
    }
  }, [conversations, notifications, updateNotifications]);

  const startWith = panel.startWith;
  const existingChat = startWith
    ? conversations?.find((convo) => {
        const others = convo.users.filter((user) => user.userId !== userData?.userId);
        return others.length === 1 && others[0]?.userId === startWith.userId;
      })
    : undefined;

  // Messaging someone reopens an existing one-to-one conversation when there is one.
  useEffect(() => {
    if (existingChat) {
      setPanel((current) => ({
        ...current,
        conversationId: existingChat.id,
        startWith: undefined,
      }));
    }
  }, [existingChat, setPanel]);

  const select = (conversationId: string | null) =>
    setPanel((current) => ({
      ...current,
      conversationId: conversationId ?? undefined,
      startWith: undefined,
    }));

  if (!userData || isPending) return <Loader explanation="Loading messages" />;
  const selectedId =
    panel.conversationId && conversations?.some((c) => c.id === panel.conversationId)
      ? panel.conversationId
      : conversations?.[0]?.id;
  const selected = conversations?.find((c) => c.id === selectedId);

  const newConversation = (
    <NewConversationPrompt
      key={startWith?.userId ?? "new"}
      newButton={
        <span className="text-muted-foreground hover:text-foreground flex h-[36px] w-[36px] items-center justify-center rounded-full border border-dashed">
          <Plus className="h-[16px] w-[16px]" aria-hidden />
          <span className="sr-only">New conversation</span>
        </span>
      }
      preSelectedUser={startWith && !existingChat ? startWith : undefined}
      defaultOpen={!!startWith && !existingChat && !!conversations}
      onOpenChange={(open) => {
        if (!open) setPanel((current) => ({ ...current, startWith: undefined }));
      }}
      setSelectedConvo={(value) => {
        const id = typeof value === "function" ? value(selectedId ?? null) : value;
        select(id);
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      {!hideRail && (
        <nav
          aria-label="Conversations"
          className="bg-muted/30 flex w-[56px] shrink-0 flex-col items-center gap-[8px] overflow-y-auto border-r py-[8px]"
        >
          {conversations?.map((convo) => (
            <ConversationAvatar
              key={convo.id}
              convo={convo}
              meId={userData.userId}
              selected={convo.id === selectedId}
              muted={mutes.isSilenced(convo.id)}
              onSelect={() => select(convo.id)}
            />
          ))}
          <div className="mt-auto pt-[4px]">{newConversation}</div>
        </nav>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <ChatConversation
            key={selected.id}
            convoId={selected.id}
            onMessageUser={onMessageUser}
            toolbarStart={
              <span className="truncate text-[13px] font-semibold">
                {conversationTitle(selected, userData.userId)}
              </span>
            }
            toolbarEnd={
              <>
                <MuteButton
                  label={conversationTitle(selected, userData.userId)}
                  muted={mutes.isMuted(selected.id)}
                  onToggle={() => mutes.toggleMute(selected.id)}
                />
                <ConversationMenu convo={selected} meId={userData.userId} />
                {hideRail && newConversation}
              </>
            }
          />
        ) : (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-[12px] p-[24px] text-center text-[13px]">
            <p>No private messages yet.</p>
            {newConversation}
          </div>
        )}
      </div>
    </div>
  );
}

/** Avatar for one conversation in the inbox rail, with unread and mute marks. */
function ConversationAvatar({
  convo,
  meId,
  selected,
  muted,
  onSelect,
}: {
  convo: InboxConversation;
  meId: string;
  selected: boolean;
  muted: boolean;
  onSelect: () => void;
}) {
  const others = convo.users.filter((user) => user.userId !== meId);
  const unread = !muted && isConversationUnread(convo);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={conversationTitle(convo, meId)}
      aria-label={`${conversationTitle(convo, meId)}${unread ? ", unread" : ""}${muted ? ", muted" : ""}`}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative h-[36px] w-[36px] shrink-0 rounded-full",
        selected && "ring-primary ring-offset-background ring-2 ring-offset-2",
      )}
    >
      {others.length > 1 ? (
        <span className="relative block h-[36px] w-[36px]">
          {others.slice(0, 2).map((user, index) => (
            <span
              key={user.userId}
              className={cn(
                "border-background absolute h-[24px] w-[24px] overflow-hidden rounded-full border-2",
                index === 0 ? "top-0 left-0" : "right-0 bottom-0",
              )}
            >
              <AvatarImage href={user.userData.avatar} alt="" size={24} />
            </span>
          ))}
        </span>
      ) : (
        <span className="block h-[36px] w-[36px] overflow-hidden rounded-full">
          <AvatarImage href={others[0]?.userData.avatar} alt="" size={36} />
        </span>
      )}
      {unread && (
        <span className="border-background absolute -top-[2px] -right-[2px] h-[12px] w-[12px] rounded-full border-2 bg-red-500" />
      )}
      {muted && (
        <BellOff className="bg-background text-muted-foreground absolute -right-[4px] -bottom-[4px] h-[14px] w-[14px] rounded-full p-[2px]" />
      )}
    </button>
  );
}

/** Profile, block and leave actions for a private conversation. */
function ConversationMenu({ convo, meId }: { convo: InboxConversation; meId: string }) {
  const [open, setOpen] = useState(false);
  const setPanel = useSetAtom(chatPanelAtom);
  const utils = api.useUtils();
  const others = convo.users.filter((user) => user.userId !== meId);
  const partner = others.length === 1 ? others[0] : undefined;
  const { mutate: toggleBlock, isPending: isBlocking } =
    api.profile.toggleBlacklistEntry.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) await utils.profile.getBlacklist.invalidate();
      },
    });
  const { mutate: exitConversation, isPending: isLeaving } =
    api.comments.exitConversation.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          setOpen(false);
          setPanel((current) => ({ ...current, conversationId: undefined }));
          await utils.comments.getUserConversations.invalidate();
        }
      },
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="w-[32px]"
          aria-label={`Options for ${conversationTitle(convo, meId)}`}
        >
          <MoreHorizontal className="h-[16px] w-[16px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="w-[224px] p-[4px]">
        <div role="menu" aria-label={`Options for ${conversationTitle(convo, meId)}`}>
          {partner && (
            <>
              <Link
                href={`/username/${partner.userData.username}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={menuItemClass}
              >
                <UserRound /> See {partner.userData.username}&apos;s profile
              </Link>
              <MenuButton
                destructive
                disabled={isBlocking}
                onClick={() => toggleBlock({ userId: partner.userId })}
              >
                <Ban /> Block {partner.userData.username}
              </MenuButton>
            </>
          )}
          <Confirm
            id={`leave-${convo.id}`}
            title="Leave conversation"
            button={
              <span className={cn(menuItemClass, "text-destructive")}>
                <LogOut /> Leave conversation
              </span>
            }
            proceed_label="Leave"
            proceed_loading_label="Leaving"
            isLoading={isLeaving}
            keepOpenOnAccept={true}
            onAccept={(event) => {
              event.preventDefault();
              if (!isLeaving) exitConversation({ convo_id: convo.id });
            }}
          >
            <p>
              You are about to leave &quot;{conversationTitle(convo, meId)}&quot;. Are
              you sure?
            </p>
          </Confirm>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Phone start screen: taverns, then private conversations. */
function PhoneChatList({ onOpen }: { onOpen: (chat: PhoneChat) => void }) {
  const { data: userData } = useUserData();
  const setPanel = useSetAtom(chatPanelAtom);
  const mutes = useChatMutes();
  const { availTaverns, isLoading } = useTaverns(userData);
  const { data: conversations, isPending } = api.comments.getUserConversations.useQuery(
    { selectedConvo: null },
    { enabled: !!userData },
  );
  if (!userData || isLoading) return <Loader explanation="Loading chats" />;
  const rowClass =
    "flex min-h-[56px] w-full items-center gap-[12px] border-b px-[12px] py-[8px] text-left hover:bg-muted/50";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h3 className="text-muted-foreground px-[12px] pt-[12px] pb-[4px] text-[11px] font-semibold tracking-wide uppercase">
        Taverns
      </h3>
      {availTaverns.map((name) => (
        <button
          key={name}
          type="button"
          className={rowClass}
          onClick={() => onOpen({ kind: "tavern", tavern: name })}
        >
          <span className="bg-muted text-muted-foreground flex h-[36px] w-[36px] items-center justify-center rounded-full font-bold">
            #
          </span>
          <span className="text-[13px] font-semibold">{name}</span>
        </button>
      ))}
      <h3 className="text-muted-foreground px-[12px] pt-[16px] pb-[4px] text-[11px] font-semibold tracking-wide uppercase">
        Messages
      </h3>
      {isPending ? (
        <Loader explanation="Loading messages" />
      ) : conversations?.length ? (
        conversations.map((convo) => {
          const others = convo.users.filter((user) => user.userId !== userData.userId);
          const muted = mutes.isSilenced(convo.id);
          const unread = !muted && isConversationUnread(convo);
          return (
            <button
              key={convo.id}
              type="button"
              className={rowClass}
              onClick={() => {
                setPanel((current) => ({
                  ...current,
                  tab: "inbox",
                  conversationId: convo.id,
                }));
                onOpen({ kind: "inbox" });
              }}
            >
              <span className="h-[36px] w-[36px] shrink-0 overflow-hidden rounded-full">
                <AvatarImage href={others[0]?.userData.avatar} alt="" size={36} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn("block truncate text-[13px]", unread && "font-bold")}
                >
                  {conversationTitle(convo, userData.userId)}
                </span>
                <span className="text-muted-foreground block truncate text-[12px]">
                  {others.map((user) => user.userData.username).join(", ")}
                </span>
              </span>
              {muted && (
                <BellOff
                  className="text-muted-foreground h-[16px] w-[16px]"
                  aria-label="Muted"
                />
              )}
              {unread && (
                <span className="h-[10px] w-[10px] rounded-full bg-red-500">
                  <span className="sr-only">Unread</span>
                </span>
              )}
            </button>
          );
        })
      ) : (
        <p className="text-muted-foreground px-[12px] py-[16px] text-[13px]">
          No private messages yet.
        </p>
      )}
      <div className="p-[12px]">
        <NewConversationPrompt
          newButton={
            <span className="flex h-[36px] items-center gap-[4px] rounded-md border px-[12px] text-[13px]">
              <Plus className="h-[16px] w-[16px]" aria-hidden /> New message
            </span>
          }
          setSelectedConvo={(value) => {
            const id = typeof value === "function" ? value(null) : value;
            if (!id) return;
            setPanel((current) => ({ ...current, tab: "inbox", conversationId: id }));
            onOpen({ kind: "inbox" });
          }}
        />
      </div>
    </div>
  );
}

function MuteButton({
  label,
  muted,
  onToggle,
}: {
  label: string;
  muted: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="w-[32px]"
      aria-pressed={muted}
      aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
      title={muted ? `Unmute ${label}` : `Mute ${label}`}
      onClick={onToggle}
    >
      {muted ? (
        <BellOff className="h-[16px] w-[16px]" />
      ) : (
        <Bell className="h-[16px] w-[16px]" />
      )}
    </Button>
  );
}

const menuItemClass =
  "flex min-h-[36px] w-full items-center gap-[8px] rounded-sm px-[8px] text-left text-[13px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50 [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:shrink-0";

function MenuButton({
  children,
  destructive,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(menuItemClass, destructive && "text-destructive")}
      {...props}
    >
      {children}
    </button>
  );
}

/** A conversation's title, or its other members when it has none. */
const conversationTitle = (convo: InboxConversation, meId: string) =>
  convo.title ||
  convo.users
    .filter((user) => user.userId !== meId)
    .map((user) => user.userData.username)
    .join(", ") ||
  "Conversation";

type InboxConversation = RouterOutputs["comments"]["getUserConversations"][number];

type PhoneChat = { kind: "tavern"; tavern: string } | { kind: "inbox" };
