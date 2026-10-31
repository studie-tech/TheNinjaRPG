"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AtSign,
  Ban,
  BarChart2,
  Flag,
  Mail,
  Reply,
  SmilePlus,
  SquarePen,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ConversationComment } from "@/drizzle/schema";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import EmojiPicker from "@/layout/EmojiPicker";
import Link from "@/layout/Link";
import { ModerationSummary } from "@/layout/ModerationSummary";
import { getPostUserClasses, type PostProps } from "@/layout/Post";
import ReportUser from "@/layout/Report";
import RichInput from "@/layout/RichInput";
import type { ChatStartUser } from "@/libs/chatPanel";
import { showUserRank } from "@/libs/profile";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canDeleteComment, canSeeSecretData } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import {
  type DeleteCommentSchema,
  type MutateCommentSchema,
  mutateCommentSchema,
} from "@/validators/comments";

/**
 * A conversation message as one dense chat row: avatar menu, name line, content,
 * reactions, and hover actions. Mutations stay with `CommentOnConversation`.
 */
export function CompactComment(props: CompactCommentProps) {
  const { data: userData } = useUserData();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const { user, comment } = props;
  const isAuthor = !!userData && userData.userId === user.userId;
  const isQuoted = props.quoteIds?.includes(comment.id) ?? false;
  const { userColor } = getPostUserClasses(user, props.tavernStyling);
  const time = comment.createdAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const reactions = Object.entries(comment.reactions ?? {});

  return (
    <article
      aria-label={`Message from ${user.username}`}
      className={cn(
        "group hover:bg-muted/40 relative flex gap-[8px] rounded-md px-[8px] py-[6px]",
        props.highlighted && "bg-primary/10",
        isQuoted && "ring-primary/50 ring-1",
      )}
    >
      <UserMenu
        user={user}
        isSelf={isAuthor}
        onMention={props.onMentionUser}
        onMessage={props.onMessageUser}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-[6px] text-[12px]">
          <Link
            href={`/username/${user.username}`}
            className={cn("text-[13px] font-bold hover:underline", userColor)}
          >
            {user.username}
          </Link>
          <span className="bg-muted text-muted-foreground rounded px-[4px] text-[11px]">
            Lv {user.level} · {showUserRank(user)}
          </span>
          {user.villageName && (
            <span className="text-muted-foreground inline-flex items-center gap-[4px]">
              {/* Village colors can be too light for text, so they mark a dot instead. */}
              {user.villageHexColor && (
                <span
                  aria-hidden
                  className="inline-block h-[8px] w-[8px] rounded-full"
                  style={{ backgroundColor: user.villageHexColor }}
                />
              )}
              {user.villageName}
            </span>
          )}
          {/* Locale and timezone differ between server and browser. */}
          <time
            dateTime={comment.createdAt.toISOString()}
            className="text-muted-foreground"
            suppressHydrationWarning
          >
            {time}
          </time>
        </div>
        {props.editing && props.editComment ? (
          <CompactEditor
            comment={comment}
            onSubmit={props.editComment}
            isPending={props.isEditPending}
          />
        ) : (
          <div
            data-reading-text
            className="[&_blockquote]:text-muted-foreground text-[13px] break-words [&_blockquote]:my-[4px] [&_blockquote]:border-l-2 [&_blockquote]:pl-[8px] [&_blockquote]:text-[12px] [&_img]:max-h-[160px] [&_img]:rounded-md"
          >
            {props.children}
          </div>
        )}
        {reactions.length > 0 && (
          <div className="mt-[4px] flex flex-wrap gap-[4px]">
            {reactions.map(([emoji, usernames]) => (
              <button
                key={emoji}
                type="button"
                title={usernames.join(", ")}
                disabled={!props.toggleReaction}
                onClick={() => props.toggleReaction?.(emoji)}
                className={cn(
                  "bg-muted/60 rounded-full border px-[6px] text-[12px] leading-5",
                  userData && usernames.includes(userData.username) && "border-primary",
                )}
              >
                {emoji} {usernames.length}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className={cn(
          "bg-popover absolute -top-[8px] right-[4px] z-10 hidden items-center gap-[2px] rounded-md border px-[2px] shadow-sm group-hover:flex focus-within:flex",
          emojiOpen && "flex",
        )}
      >
        {props.toggleReaction && (
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <ActionButton label="Add reaction">
                <SmilePlus />
              </ActionButton>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" collisionPadding={8}>
              {/* The popover closes on outside clicks; the picker's own handler would
                  also catch the click that reopens it. */}
              <EmojiPicker
                perLine={8}
                onSelect={(native) => {
                  props.toggleReaction?.(native);
                  setEmojiOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
        {props.setQuoteId && (
          <ActionButton
            label={isQuoted ? "Stop replying" : "Reply"}
            pressed={isQuoted}
            onClick={() => props.setQuoteId?.(comment.id)}
          >
            <Reply />
          </ActionButton>
        )}
        {isAuthor && props.editComment && (
          <ActionButton
            label="Edit message"
            pressed={props.editing}
            onClick={() => props.setEditing((prev) => !prev)}
          >
            <SquarePen />
          </ActionButton>
        )}
        {userData && (isAuthor || canSeeSecretData(userData.role)) && (
          <ModerationSummary
            userId={user.userId}
            username={user.username}
            trigger={
              <ActionButton label="Moderation summary">
                <BarChart2 />
              </ActionButton>
            }
          />
        )}
        {!isAuthor && !comment.isReported && (
          <ReportUser
            user={user}
            content={comment}
            system="conversation_comment"
            button={
              <ActionGlyph label="Report message">
                <Flag />
              </ActionGlyph>
            }
          />
        )}
        {userData && canDeleteComment(userData, user.userId) && props.deleteComment && (
          <Confirm
            id={`delete-comment-${comment.id}`}
            title="Confirm Deletion"
            button={
              <ActionGlyph label="Delete message">
                <Trash2 />
              </ActionGlyph>
            }
            disabled={props.isDeletePending}
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
            proceed_label="Delete comment"
            proceed_loading_label="Deleting"
            isLoading={props.isDeletePending}
            keepOpenOnAccept={true}
            onAccept={(e) => {
              e.preventDefault();
              if (!props.isDeletePending) props.deleteComment?.({ id: comment.id });
            }}
          >
            <p>Delete this comment by {user.username}? This cannot be undone.</p>
          </Confirm>
        )}
      </div>
    </article>
  );
}

/** Avatar that opens profile, message, mention and block actions for a poster. */
function UserMenu({
  user,
  isSelf,
  onMention,
  onMessage,
}: {
  user: CompactCommentProps["user"];
  isSelf: boolean;
  onMention?: (username: string) => void;
  onMessage?: (user: ChatStartUser) => void;
}) {
  const [open, setOpen] = useState(false);
  const utils = api.useUtils();
  const { mutate: toggleBlock, isPending } =
    api.profile.toggleBlacklistEntry.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          setOpen(false);
          await Promise.all([
            utils.profile.getBlacklist.invalidate(),
            utils.comments.getConversationComments.invalidate(),
          ]);
        }
      },
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="focus-visible:ring-ring h-[28px] w-[28px] shrink-0 overflow-hidden rounded-full focus-visible:ring-2"
        aria-label={`Actions for ${user.username}`}
      >
        <AvatarImage
          href={user.avatar}
          userId={user.userId}
          alt={user.username}
          size={28}
          className="rounded-full"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-[208px] p-[4px]"
        role="menu"
        aria-label={`Actions for ${user.username}`}
      >
        <div className="mb-[4px] border-b px-[8px] pt-[4px] pb-[8px]">
          <p className="truncate text-[13px] font-bold">{user.username}</p>
          <p className="text-muted-foreground text-[12px]">
            Lv {user.level} {showUserRank(user)}
            {user.villageName ? ` · ${user.villageName}` : ""}
          </p>
        </div>
        <MenuItem
          asLink
          href={`/username/${user.username}`}
          onSelect={() => setOpen(false)}
        >
          <UserRound /> See profile
        </MenuItem>
        {!isSelf && onMessage && (
          <MenuItem
            onSelect={() => {
              setOpen(false);
              onMessage(user);
            }}
          >
            <Mail /> Send private message
          </MenuItem>
        )}
        {!isSelf && onMention && (
          <MenuItem
            onSelect={() => {
              setOpen(false);
              onMention(user.username);
            }}
          >
            <AtSign /> Mention in chat
          </MenuItem>
        )}
        {!isSelf && (
          <>
            <div className="my-[4px] border-t" />
            <MenuItem
              destructive
              disabled={isPending}
              onSelect={() => toggleBlock({ userId: user.userId })}
            >
              <Ban /> Block user
            </MenuItem>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  children,
  onSelect,
  asLink,
  href,
  destructive,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  asLink?: boolean;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const className = cn(
    "hover:bg-muted focus-visible:bg-muted flex min-h-[36px] w-full items-center gap-[8px] rounded-sm px-[8px] text-left text-[13px] focus-visible:outline-none disabled:opacity-50 [&_svg]:h-[16px] [&_svg]:w-[16px]",
    destructive && "text-destructive",
  );
  if (asLink && href) {
    return (
      <Link href={href} role="menuitem" className={className} onClick={onSelect}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function ActionButton({
  label,
  pressed,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(actionClass, pressed && "text-primary")}
      {...props}
    >
      {children}
    </button>
  );
}

const actionClass =
  "flex h-[28px] w-[28px] items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:h-[16px] [&_svg]:w-[16px]";

/** Icon for triggers that bring their own clickable wrapper (report, delete). */
function ActionGlyph({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className={actionClass} title={label}>
      {children}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Inline editor for the author's own message. */
function CompactEditor({
  comment,
  onSubmit,
  isPending,
}: {
  comment: ConversationComment;
  onSubmit: (data: MutateCommentSchema) => void;
  isPending?: boolean;
}) {
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<MutateCommentSchema>({
    defaultValues: {
      object_id: comment.id,
      comment: comment.content,
      quoteIds: null,
      senderId: null,
    },
    resolver: zodResolver(mutateCommentSchema),
  });
  const submit = handleSubmit((data) => {
    if (!isPending) onSubmit(data);
  });
  return (
    <form onSubmit={submit} className="mt-[4px]">
      <RichInput
        id="comment"
        height="80"
        placeholder={comment.content}
        control={control}
        disabled={isPending}
        onSubmit={submit}
        error={errors.comment?.message}
      />
    </form>
  );
}

export interface CompactCommentProps {
  user: NonNullable<PostProps["user"]>;
  comment: ConversationComment;
  children: React.ReactNode;
  tavernStyling?: boolean;
  highlighted?: boolean;
  quoteIds?: string[] | null;
  editing: boolean;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  editComment?: (data: MutateCommentSchema) => void;
  isEditPending?: boolean;
  deleteComment?: (data: DeleteCommentSchema) => void;
  isDeletePending?: boolean;
  toggleReaction?: (emoji: string) => void;
  setQuoteId?: (id: string) => void;
  onMentionUser?: (username: string) => void;
  onMessageUser?: (user: ChatStartUser) => void;
}
