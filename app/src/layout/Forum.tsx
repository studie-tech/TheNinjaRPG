"use client";

import {
  Bell,
  BellOff,
  Clock3,
  LayoutGrid,
  LockKeyhole,
  MessageSquare,
  Pin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ContentImageSelector from "@/layout/ContentImageSelector";
import { ForumAttachments } from "@/layout/ForumAttachments";
import Link from "@/layout/Link";
import RichInput from "@/layout/RichInput";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { hasForumContent } from "@/libs/forumContent";
import { showMutationToast } from "@/libs/toast";
import { canPostAsAi } from "@/utils/permissions";
import { useUserPicker } from "@/utils/search";
import { safeLocalStorageRemoveItem } from "@/utils/storage";
import { useUserData } from "@/utils/UserContext";

/** Keep browse shortcuts compact in the header and expose staff tools only to eligible accounts. */
export const ForumNavigation = ({
  showBrowseLinks = true,
}: {
  showBrowseLinks?: boolean;
}) => {
  const { data: context } = api.forum.getContext.useQuery();
  const canAccessStaffWorkspace = context?.canManage || context?.canModerate;
  if (!showBrowseLinks && !canAccessStaffWorkspace) return null;
  return (
    <nav aria-label="Forum navigation" className="flex flex-wrap justify-end gap-1">
      {showBrowseLinks && (
        <>
          <Button asChild variant="outline" size="icon" hoverText="All boards">
            <Link href="/forum" aria-label="All boards">
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon" hoverText="Latest discussions">
            <Link href="/forum?view=latest" aria-label="Latest discussions">
              <Clock3 className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </>
      )}
      {canAccessStaffWorkspace && (
        <Button asChild variant="outline" size="icon" hoverText="Staff workspace">
          <Link href="/forum/manage" aria-label="Staff workspace">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      )}
    </nav>
  );
};
/**
 * Render server-authorized topics with unread/resume links and optional staff selection.
 * The whole row opens the topic; inner links and the selection box stay separate targets.
 */
export const ForumTopicList = ({
  threads,
  selectable,
  selected,
  onSelect,
  empty,
}: {
  threads: RouterOutputs["forum"]["getThreads"]["threads"];
  selectable?: boolean;
  selected?: string[];
  onSelect?: (id: string) => void;
  /** Replaces the generic empty state, e.g. to invite the first topic on a board. */
  empty?: ReactNode;
}) => (
  <div className="bg-popover divide-y rounded-lg border">
    {threads.length === 0 &&
      (empty ?? (
        <ForumEmptyState
          title="No discussions found"
          detail="Try another search or start a topic in a board."
        />
      ))}
    {threads.map((t) => (
      <div
        key={t.id}
        className="hover:bg-muted/40 relative flex min-w-0 items-start gap-3 p-4 sm:items-center"
      >
        {selectable && (
          <input
            type="checkbox"
            className="relative z-10 mt-1 h-5 w-5 shrink-0"
            aria-label={`Select ${t.title}`}
            checked={selected?.includes(t.id) ?? false}
            onChange={() => onSelect?.(t.id)}
          />
        )}
        <MessageSquare
          aria-hidden
          className={`mt-1 hidden h-5 w-5 shrink-0 sm:block ${t.unread ? "text-orange-600" : "text-muted-foreground"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
            {t.unread && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-900">
                Unread
              </span>
            )}
            {t.isPinned && (
              <span className="flex items-center gap-1">
                <Pin className="h-3 w-3" />
                Pinned
              </span>
            )}
            {t.isLocked && (
              <span className="flex items-center gap-1">
                <LockKeyhole className="h-3 w-3" />
                Locked
              </span>
            )}
            {t.kind === "QUESTION" && (
              <span
                className={
                  t.acceptedPostId ? "text-green-700" : "text-muted-foreground"
                }
              >
                {t.acceptedPostId ? "Answered" : "Question"}
              </span>
            )}
            {t.kind === "ANNOUNCEMENT" && (
              <span className="font-semibold text-orange-700">Announcement</span>
            )}
          </div>
          <Link
            href={`/forum/${t.boardId}/${t.id}`}
            className="block text-base leading-snug font-semibold break-words after:absolute after:inset-0 hover:underline"
          >
            {t.title}
          </Link>
          <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span>{t.user?.username ?? "Deleted player"}</span>
            <Link
              href={`/forum/${t.boardId}`}
              className="relative z-10 hover:underline"
            >
              {t.boardName}
            </Link>
            {t.tags?.map((tag) => (
              <Link
                href={`/forum?view=latest&tag=${encodeURIComponent(tag)}`}
                key={tag}
                className="bg-muted relative z-10 rounded px-1.5"
              >
                {tag}
              </Link>
            ))}
          </div>
          {t.resumePostId && (
            <Link
              href={`/forum/${t.boardId}/${t.id}?post=${t.resumePostId}`}
              className="relative z-10 mt-2 inline-block text-xs font-medium text-orange-700 hover:underline"
            >
              Resume reading
            </Link>
          )}
        </div>
        <div className="text-muted-foreground shrink-0 text-right text-xs">
          <span className="text-foreground block font-semibold">
            {replyCount(t.nPosts)} {replyCount(t.nPosts) === 1 ? "reply" : "replies"}
          </span>
          <time suppressHydrationWarning dateTime={t.updatedAt.toISOString()}>
            {t.updatedAt.toLocaleDateString()}
          </time>
        </div>
      </div>
    ))}
  </div>
);
/** Save account-owned board/topic watches and optional push preferences through the forum router. */
export const ForumWatchButton = ({
  scope,
  scopeId,
}: {
  scope: "THREAD" | "BOARD";
  scopeId: string;
}) => {
  const { data: user } = useUserData();
  const utils = api.useUtils();
  const { data } = api.forum.personal.useQuery(undefined, { enabled: !!user });
  const watch = data?.watches.find((w) => w.scope === scope && w.scopeId === scopeId);
  const mutation = api.forum.watch.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) await utils.forum.personal.invalidate();
    },
  });
  if (!user) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ scope, scopeId, active: !watch, push: false })}
      >
        {watch ? (
          <BellOff className="mr-2 h-4 w-4" />
        ) : (
          <Bell className="mr-2 h-4 w-4" />
        )}
        {watch ? "Unwatch" : "Watch"}
      </Button>
      {watch && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={watch.push}
            disabled={mutation.isPending}
            onChange={(e) =>
              mutation.mutate({ scope, scopeId, active: true, push: e.target.checked })
            }
          />
          Push alerts
        </label>
      )}
    </div>
  );
};
/** Account-scoped drafts recover only on request; successful submissions clear the stored copy. */
export const ForumComposer = ({
  draftKey,
  title = false,
  pending,
  quote = "",
  coverImage = false,
  defaultKind = "DISCUSSION",
  onSubmit,
  uploads = true,
}: {
  draftKey: string;
  title?: boolean;
  pending: boolean;
  quote?: string;
  coverImage?: boolean;
  defaultKind?: "DISCUSSION" | "QUESTION";
  uploads?: boolean;
  onSubmit: (
    values: Omit<Draft, "tags" | "image"> & {
      tags: string[];
      image: string | null;
      senderId: string | null;
    },
  ) => Promise<boolean>;
}) => {
  const fieldPrefix = useId();
  const { data: user } = useUserData();
  const form = useForm<Draft>({
    defaultValues: { content: "", title: "", kind: defaultKind, tags: "", image: "" },
  });
  const { methods: senderForm, users: senders } = useUserPicker();
  const [storageAvailable, setStorageAvailable] = useState(true);
  const values = useWatch({ control: form.control });
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const processedQuote = useRef("");
  const isBlocked = pending || !ready || !!recovery;
  const storageKey = `forum-draft:${user?.userId}:${draftKey}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const value = JSON.parse(raw) as Draft;
        if (
          typeof value.content === "string" &&
          typeof value.title === "string" &&
          typeof value.tags === "string" &&
          ["DISCUSSION", "QUESTION", "ANNOUNCEMENT"].includes(value.kind)
        )
          setRecovery({ ...value, image: value.image ?? "" });
      }
    } catch {
      setStorageAvailable(false);
    }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready || recovery || !user) return;
    try {
      if (values.content || values.title)
        localStorage.setItem(storageKey, JSON.stringify(values));
      else localStorage.removeItem(storageKey);
    } catch {
      setStorageAvailable(false);
    }
  }, [ready, recovery, storageKey, user, values]);
  useEffect(() => {
    if (!ready || !quote || processedQuote.current === quote) return;
    processedQuote.current = quote;
    if (recovery) {
      form.reset({ ...recovery, content: `${recovery.content}\n${quote}` });
      setRecovery(null);
    } else form.setValue("content", `${form.getValues("content")}\n${quote}`);
  }, [quote, ready, recovery, form]);
  const submit = form.handleSubmit(async (value) => {
    setError("");
    const tags = [
      ...new Set(
        value.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    if (!hasForumContent(value.content) || (title && value.title.trim().length < 4)) {
      setError("Write at least 4 characters in the message and topic title.");
      return;
    }
    if (
      value.content.length > (title ? 10000 : 5000) ||
      tags.length > 5 ||
      tags.some((t) => t.length > 32)
    ) {
      setError(
        `Use up to ${title ? "10,000" : "5,000"} characters and five tags of at most 32 characters.`,
      );
      return;
    }
    try {
      const success = await onSubmit({
        ...value,
        tags,
        image: value.image || null,
        senderId: senders?.[0]?.userId ?? null,
      });
      if (success) {
        form.reset({ content: "", title: "", kind: defaultKind, tags: "", image: "" });
        setRecovery(null);
        safeLocalStorageRemoveItem(storageKey);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your post could not be saved. Your draft is still here.",
      );
    }
  });
  return (
    <form
      onSubmit={submit}
      className="bg-popover space-y-3 rounded-lg border p-4"
      id="forum-composer"
    >
      <h3 className="font-semibold">
        {title ? "Start a discussion" : "Write a reply"}
      </h3>
      {recovery && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
          <span>A saved draft is available.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              form.reset(recovery);
              setRecovery(null);
            }}
          >
            Restore draft
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRecovery(null);
              safeLocalStorageRemoveItem(storageKey);
            }}
          >
            Discard draft
          </Button>
        </div>
      )}
      {title && (
        <>
          <label className="block text-sm" htmlFor={`${fieldPrefix}-1`}>
            Topic title
            <Input
              id={`${fieldPrefix}-1`}
              {...form.register("title")}
              maxLength={88}
              placeholder="What would you like to discuss?"
              disabled={isBlocked}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Discussion type
              <select
                {...form.register("kind")}
                className="bg-background mt-1 block h-10 w-full rounded-md border px-2"
                disabled={isBlocked}
              >
                <option value="DISCUSSION">Discussion</option>
                <option value="QUESTION">Question</option>
              </select>
            </label>
            <label className="text-sm" htmlFor={`${fieldPrefix}-2`}>
              Tags
              <Input
                id={`${fieldPrefix}-2`}
                {...form.register("tags")}
                placeholder="strategy, recruitment"
                disabled={isBlocked}
              />
            </label>
          </div>
        </>
      )}
      {title && user && canPostAsAi(user.role) && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm">Post as an AI character</summary>
          <UserSearchSelect
            useFormMethods={senderForm}
            showYourself={false}
            showAi
            maxUsers={1}
          />
        </details>
      )}
      {title && coverImage && uploads && (
        <ContentImageSelector
          label="News image (also used for Instagram)"
          imageUrl={values.image}
          id={draftKey}
          prompt={values.title || "News announcement"}
          allowImageUpload
          type="ai"
          size="square"
          maxDim={1080}
          disabled={isBlocked}
          onUploadComplete={(url) => form.setValue("image", url)}
        />
      )}
      <RichInput
        id="content"
        control={form.control}
        height="200px"
        allowClipboardPaste={uploads}
        allowImages={uploads}
        enableMentions
        autoFocus={false}
        focusEndOnExternalChange={!!quote}
        disabled={isBlocked}
        onUploadPendingChange={setUploading}
      />
      {uploads && (
        <ForumAttachments
          content={values.content ?? ""}
          onChange={(content) =>
            form.setValue("content", content, { shouldDirty: true })
          }
          disabled={isBlocked || uploading}
        />
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {!storageAvailable
            ? "Draft recovery is unavailable on this device. Keep a copy before leaving."
            : ready
              ? "Draft saved on this device as you write."
              : "Preparing draft recovery…"}
        </span>
        <Button type="submit" disabled={isBlocked || uploading}>
          {pending ? "Posting…" : title ? "Create topic" : "Post reply"}
        </Button>
      </div>
    </form>
  );
};
/** Keep search input synchronized with navigation while letting the caller own URL updates. */
export const ForumSearch = ({
  query,
  onSearch,
}: {
  query: string;
  onSearch: (query: string) => void;
}) => {
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft);
      }}
      className="flex gap-2"
    >
      <div className="relative min-w-0 flex-1">
        <Search className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
        <Input
          aria-label="Search forum"
          className="pl-9"
          placeholder="Search titles and posts…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
        />
      </div>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
};

/** Stored per account and composer scope; recovery is explicit and successful submission clears it. */
/** Centered empty-list message, with an optional action such as starting a topic. */
export const ForumEmptyState = ({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) => (
  <div className="p-8 text-center">
    <MessageSquare className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
    <p className="font-semibold">{title}</p>
    <p className="text-muted-foreground mt-1 text-sm">{detail}</p>
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

/** Replies to a topic: every post after its opening post. */
const replyCount = (nPosts: number) => Math.max(0, nPosts - 1);

type Draft = {
  content: string;
  title: string;
  kind: "DISCUSSION" | "QUESTION" | "ANNOUNCEMENT";
  tags: string;
  image: string;
};
