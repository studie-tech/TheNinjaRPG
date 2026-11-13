"use client";

import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BarChart3,
  Check,
  ChevronRight,
  ClipboardCheck,
  FolderPlus,
  FolderTree,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import ContentBox from "@/layout/ContentBox";
import { ForumNavigation } from "@/layout/Forum";
import { ForumAnalytics } from "@/layout/ForumAnalytics";
import { ForumTopicTools } from "@/layout/ForumModeration";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { useUserPicker } from "@/utils/search";
import { addDays } from "@/utils/time";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  type ForumPolicy,
  forumAudiences,
  forumCapabilities,
  forumSectionSchema,
  forumStructureBoardSchema,
} from "@/validators/forum";

/** Load one scoped staff workspace and retain scoped approvals, recovery, structure, access and audit views. */
export default function ForumManagement() {
  const fieldPrefix = useId();
  const { data: user } = useUserDataSelector((u) => ({ username: u.username }));
  const [tab, setTab] = useState("review");
  const [query, setQuery] = useState("");
  const [reviewPage, setReviewPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query);
  const data = api.forum.administration.useQuery(
    { query: debouncedQuery, reviewPage },
    { enabled: !!user, placeholderData: (previous) => previous },
  );
  const utils = api.useUtils();
  const refresh = async () => {
    await Promise.all([
      utils.forum.invalidate(),
      utils.comments.getForumComments.invalidate(),
    ]);
  };
  return (
    <ContentBox
      title="Forum tools"
      subtitle="Moderation, access and boards."
      defaultBackHref="/forum"
      topRightContent={<ForumNavigation />}
    >
      {!user ? (
        <p>Sign in with a forum staff account to continue.</p>
      ) : data.isPending ? (
        <Loader explanation="Loading staff workspace…" />
      ) : data.error ? (
        <p role="alert">
          The workspace could not load.{" "}
          <Button className="gap-2" onClick={() => void data.refetch()}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
          {query && (
            <Button variant="outline" className="gap-2" onClick={() => setQuery("")}>
              <X className="h-4 w-4" aria-hidden />
              Clear search
            </Button>
          )}
        </p>
      ) : !data.data ? (
        <p>You do not have permission to manage this forum.</p>
      ) : (
        <>
          {/* Game sidebars constrain the workspace independently of the viewport. */}
          <nav
            aria-label="Staff tools"
            className="@container mb-4 flex gap-2 border-b pb-3"
          >
            {[
              { key: "review", label: "Approvals", icon: ClipboardCheck },
              ...(data.data.canManage
                ? [
                    { key: "structure", label: "Boards", icon: FolderTree },
                    { key: "staff", label: "Staff", icon: Users },
                  ]
                : []),
              ...(data.data.canManage ||
              data.data.boards.some((b) => b.permissions.moderate)
                ? [{ key: "restrictions", label: "Restrictions", icon: Ban }]
                : []),
              { key: "logs", label: "Audit log", icon: ScrollText },
              ...(data.data.canManage ||
              data.data.boards.some((b) => b.permissions.moderate)
                ? [{ key: "analytics", label: "Analytics", icon: BarChart3 }]
                : []),
            ].map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                variant={tab === key ? "default" : "outline"}
                size="sm"
                className="h-9 w-9 shrink-0 gap-2 px-0 @min-[42rem]:h-8 @min-[42rem]:w-auto @min-[42rem]:px-3"
                aria-label={label}
                hoverText={label}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden @min-[42rem]:inline">{label}</span>
              </Button>
            ))}
          </nav>
          {tab === "structure" && <ForumStructure data={data.data} refresh={refresh} />}
          {tab === "staff" && <ForumStaff data={data.data} refresh={refresh} />}
          {tab === "restrictions" && (
            <ForumRestrictions data={data.data} refresh={refresh} />
          )}
          {tab === "review" && (
            <>
              {data.isPlaceholderData ? (
                <Loader explanation="Loading approvals and recovery…" />
              ) : (
                <ForumApprovals key={reviewPage} data={data.data} refresh={refresh} />
              )}
              {(reviewPage > 0 || data.data.hasMoreReviews) && (
                <nav
                  aria-label="Approvals and recovery pages"
                  className="mt-4 flex items-center justify-end gap-3"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={reviewPage === 0 || data.isFetching}
                    onClick={() => setReviewPage((page) => page - 1)}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    Previous
                  </Button>
                  <span className="text-sm">Page {reviewPage + 1}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={!data.data.hasMoreReviews || data.isFetching}
                    onClick={() => setReviewPage((page) => page + 1)}
                  >
                    Next
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                </nav>
              )}
            </>
          )}
          {tab === "analytics" && <ForumAnalytics />}
          {tab === "logs" && (
            <div className="space-y-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <ScrollText className="h-4 w-4" aria-hidden />
                Audit log
              </h2>
              <div className="flex items-end gap-2">
                <label className="block flex-1 text-sm" htmlFor={`${fieldPrefix}-1`}>
                  <Search className="mr-1 inline h-3 w-3" aria-hidden />
                  Find an action, reason, player or target
                  <Input
                    id={`${fieldPrefix}-1`}
                    placeholder="Search the audit log"
                    maxLength={200}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Clear search"
                  hoverText="Clear search"
                  disabled={!query}
                  onClick={() => setQuery("")}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {data.data.logs.length} matching actions · showing up to 100 recent
                entries.
              </p>
              {data.data.logs.length === 0 ? (
                <p className="rounded-md border p-6 text-sm">
                  No matching moderation actions.
                </p>
              ) : (
                data.data.logs.map((log) => (
                  <details key={log.id} className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm break-words">
                      <b>{log.action.replaceAll(".", " · ").replaceAll("_", " ")}</b> ·{" "}
                      {log.reason}
                      <span
                        className="text-muted-foreground mt-1 block text-xs"
                        suppressHydrationWarning
                      >
                        {log.createdAt.toLocaleString()} ·{" "}
                        {log.actorName ?? "Former player"}
                      </span>
                    </summary>
                    <div className="mt-3 text-xs">
                      <p>Target: {log.targetId}</p>
                      <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded p-3 break-all whitespace-pre-wrap">
                        {JSON.stringify(
                          { before: log.before, after: log.after },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  </details>
                ))
              )}
            </div>
          )}
        </>
      )}
    </ContentBox>
  );
}

/** Navigate the stable section/board hierarchy and focus newly opened configuration forms. */
function ForumStructure({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<{ type: "section" | "board"; id?: string } | null>(
    null,
  );
  const [remove, setRemove] = useState<{
    type: "BOARD" | "SECTION";
    id: string;
  } | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const removeRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Keep keyboard focus in the current task and return it to the directory on close.
    const target = edit
      ? editRef.current?.querySelector<HTMLHeadingElement>("h2")
      : remove
        ? removeRef.current
        : headingRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [edit, remove]);
  const closeEditor = () => {
    setEdit(null);
    setRemove(null);
    void refresh();
  };
  const repair = api.forum.repairCounters.useMutation({
    onSuccess: async (r) => {
      showMutationToast(r);
      if (r.success) await refresh();
    },
  });
  return (
    <div className="space-y-4">
      {!edit && !remove && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 ref={headingRef} tabIndex={-1} className="font-semibold">
              Boards & sections
            </h2>
            <p className="text-muted-foreground text-xs">
              Choose a board or section to edit its settings.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setEdit({ type: "section" })}
            >
              <Plus className="h-4 w-4" aria-hidden />
              New section
            </Button>
            <Button
              className="gap-2"
              onClick={() => setEdit({ type: "board" })}
              disabled={!data.sections.length}
            >
              <FolderPlus className="h-4 w-4" aria-hidden />
              New board
            </Button>
          </div>
          {!data.sections.length && (
            <p className="text-muted-foreground w-full text-xs">
              Create a section before adding boards.
            </p>
          )}
        </div>
      )}
      {edit && (
        <div ref={editRef} className="scroll-mt-6">
          {edit.type === "section" && (
            <SectionEditor
              key={edit.id ?? "new-section"}
              section={data.sections.find((s) => s.id === edit.id)}
              done={closeEditor}
            />
          )}
          {edit.type === "board" && (
            <BoardEditor
              key={edit.id ?? "new-board"}
              board={data.boards.find((b) => b.id === edit.id)}
              data={data}
              done={closeEditor}
            />
          )}
        </div>
      )}
      {remove && (
        <section
          ref={removeRef}
          tabIndex={-1}
          aria-label="Remove container"
          className="focus-visible:outline-ring scroll-mt-6 rounded-lg focus-visible:outline focus-visible:outline-2"
        >
          <RemoveStructure
            key={remove.id}
            target={remove}
            data={data}
            done={closeEditor}
          />
        </section>
      )}
      {!edit &&
        !remove &&
        data.sections.map((section) => (
          <section key={section.id} className="overflow-hidden rounded-lg border">
            <div className="bg-muted/40 flex items-center gap-2 p-3">
              <div className="mr-auto min-w-0 flex-1">
                <h2 className="font-semibold">
                  {section.name}
                  {section.archived && " (archived)"}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {data.boards.filter((b) => b.sectionId === section.id).length} boards
                  · position {section.position}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label={`Edit section ${section.name}`}
                hoverText="Edit section"
                onClick={() => setEdit({ type: "section", id: section.id })}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive shrink-0"
                aria-label={`Remove section ${section.name}`}
                hoverText="Remove section"
                onClick={() => setRemove({ type: "SECTION", id: section.id })}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="divide-y">
              {data.boards
                .filter((b) => b.sectionId === section.id)
                .map((board) => (
                  <div key={board.id} className="flex items-center gap-2 p-3">
                    <div className="mr-auto min-w-0 flex-1">
                      <Link
                        href={`/forum/${board.id}`}
                        className="font-medium break-words hover:underline"
                      >
                        {board.name}
                      </Link>
                      {board.archived && <span className="ml-2 text-xs">Archived</span>}
                      <p className="text-muted-foreground text-xs">
                        {board.nThreads} topics · {board.nPosts} posts · position{" "}
                        {board.position}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Edit board ${board.name}`}
                      hoverText="Edit board"
                      onClick={() => setEdit({ type: "board", id: board.id })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Recount ${board.name}`}
                      hoverText="Repair topic and post counts"
                      disabled={repair.isPending}
                      onClick={() => repair.mutate({ boardId: board.id })}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive shrink-0"
                      aria-label={`Remove board ${board.name}`}
                      hoverText="Remove board"
                      onClick={() => setRemove({ type: "BOARD", id: board.id })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
            </div>
          </section>
        ))}
    </div>
  );
}
/** Save shared section defaults with an audit reason; close the editor only after success. */
function SectionEditor({
  section,
  done,
}: {
  section?: Administration["sections"][number];
  done: () => void;
}) {
  const fieldPrefix = useId();
  const [values, setValues] = useState<z.infer<typeof forumSectionSchema>>({
    id: section?.id,
    name: section?.name ?? "",
    summary: section?.summary ?? "",
    position: section?.position ?? 0,
    archived: section?.archived ?? false,
    policy: section?.policy ?? {},
    reason: "",
  });
  const [error, setError] = useState("");
  const save = api.forum.saveSection.useMutation();
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (save.isPending) return;
        setError("");
        const parsed = forumSectionSchema.safeParse(values);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the form");
          return;
        }
        try {
          const result = await save.mutateAsync(parsed.data);
          showMutationToast(result);
          if (result.success) done();
          else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Section could not be saved");
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <h2 tabIndex={-1} className="min-w-0 font-semibold break-words">
          {section ? `Edit section: ${section.name}` : "New section"}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          disabled={save.isPending}
          onClick={done}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to boards
        </Button>
      </div>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-2`}>
        Name
        <Input
          id={`${fieldPrefix}-2`}
          value={values.name}
          required
          minLength={2}
          maxLength={100}
          onChange={(e) =>
            setValues((current) => ({ ...current, name: e.target.value }))
          }
        />
      </label>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-3`}>
        Description
        <Textarea
          id={`${fieldPrefix}-3`}
          value={values.summary}
          onChange={(e) =>
            setValues((current) => ({ ...current, summary: e.target.value }))
          }
          rows={2}
          maxLength={1000}
        />
      </label>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-4`}>
        Position
        <NumberInput
          id={`${fieldPrefix}-4`}
          value={values.position}
          min={0}
          max={10000}
          onValueChange={(position) =>
            setValues((current) => ({ ...current, position }))
          }
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.archived}
          onChange={(e) =>
            setValues((current) => ({ ...current, archived: e.target.checked }))
          }
        />
        Archive section (keep its discussions readable)
      </label>
      <PolicyEditor
        policy={values.policy}
        onChange={(policy) => setValues((current) => ({ ...current, policy }))}
      />
      <Reason
        value={values.reason}
        setValue={(reason) => setValues((current) => ({ ...current, reason }))}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={save.isPending}
          onClick={done}
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </Button>
        <Button className="gap-2" disabled={save.isPending} aria-busy={save.isPending}>
          <Save className="h-4 w-4" aria-hidden />
          {save.isPending ? "Saving…" : "Save section"}
        </Button>
      </div>
    </form>
  );
}
/** Edit board overrides and hierarchy through shared validators; inherited settings stay explicit. */
function BoardEditor({
  board,
  data,
  done,
}: {
  board?: Administration["boards"][number];
  data: Administration;
  done: () => void;
}) {
  const fieldPrefix = useId();
  const [values, setValues] = useState<z.infer<typeof forumStructureBoardSchema>>({
    id: board?.id,
    sectionId: board?.sectionId ?? data.sections[0]?.id ?? "",
    parentId: board?.parentId ?? null,
    name: board?.name ?? "",
    summary: board?.summary ?? "",
    rules: board?.rules ?? "",
    position: board?.position ?? 0,
    archived: board?.archived ?? false,
    policy: board?.policy ?? {},
    slowModeSeconds: board?.slowModeSeconds ?? 0,
    requireApproval: board?.requireApproval ?? false,
    reason: "",
  });
  const [error, setError] = useState("");
  const save = api.forum.saveBoard.useMutation();
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (save.isPending) return;
        setError("");
        const parsed = forumStructureBoardSchema.safeParse(values);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the form");
          return;
        }
        try {
          const result = await save.mutateAsync(parsed.data);
          showMutationToast(result);
          if (result.success) done();
          else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Board could not be saved");
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <h2 tabIndex={-1} className="min-w-0 font-semibold break-words">
          {board ? `Edit board: ${board.name}` : "New board"}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          disabled={save.isPending}
          onClick={done}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to boards
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm" htmlFor={`${fieldPrefix}-5`}>
          Name
          <Input
            id={`${fieldPrefix}-5`}
            value={values.name}
            required
            minLength={2}
            maxLength={100}
            onChange={(e) =>
              setValues((current) => ({ ...current, name: e.target.value }))
            }
          />
        </label>
        <label className="text-sm">
          Section
          <select
            className="bg-background block h-10 w-full rounded-md border px-2"
            value={values.sectionId}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                sectionId: e.target.value,
                parentId: null,
              }))
            }
          >
            {data.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Parent board
          <select
            className="bg-background block h-10 w-full rounded-md border px-2"
            value={values.parentId ?? ""}
            onChange={(e) =>
              setValues((current) => ({ ...current, parentId: e.target.value || null }))
            }
          >
            <option value="">No parent board</option>
            {data.boards
              .filter((b) => b.id !== board?.id && b.sectionId === values.sectionId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm" htmlFor={`${fieldPrefix}-6`}>
          Position
          <NumberInput
            id={`${fieldPrefix}-6`}
            min={0}
            max={10000}
            value={values.position}
            onValueChange={(position) =>
              setValues((current) => ({ ...current, position }))
            }
          />
        </label>
      </div>
      <label className="block text-sm" htmlFor={`${fieldPrefix}-7`}>
        Description
        <Textarea
          id={`${fieldPrefix}-7`}
          value={values.summary}
          rows={2}
          maxLength={2000}
          onChange={(e) =>
            setValues((current) => ({ ...current, summary: e.target.value }))
          }
        />
      </label>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          <SlidersHorizontal className="mr-2 inline h-4 w-4" aria-hidden />
          Posting & archive settings
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block text-sm" htmlFor={`${fieldPrefix}-8`}>
            Board rules
            <Textarea
              id={`${fieldPrefix}-8`}
              value={values.rules}
              maxLength={5000}
              onChange={(e) =>
                setValues((current) => ({ ...current, rules: e.target.value }))
              }
            />
          </label>
          <label className="block text-sm" htmlFor={`${fieldPrefix}-9`}>
            Seconds between replies (0 disables slow mode)
            <NumberInput
              id={`${fieldPrefix}-9`}
              min={0}
              max={86400}
              value={values.slowModeSeconds}
              onValueChange={(slowModeSeconds) =>
                setValues((current) => ({ ...current, slowModeSeconds }))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.requireApproval}
              onChange={(e) =>
                setValues((current) => ({
                  ...current,
                  requireApproval: e.target.checked,
                }))
              }
            />
            Require staff approval before publishing new posts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.archived}
              onChange={(e) =>
                setValues((current) => ({ ...current, archived: e.target.checked }))
              }
            />
            Archive board (keep discussions readable)
          </label>
        </div>
      </details>
      <PolicyEditor
        policy={values.policy}
        onChange={(policy) => setValues((current) => ({ ...current, policy }))}
      />
      <Reason
        value={values.reason}
        setValue={(reason) => setValues((current) => ({ ...current, reason }))}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={save.isPending}
          onClick={done}
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </Button>
        <Button className="gap-2" disabled={save.isPending} aria-busy={save.isPending}>
          <Save className="h-4 w-4" aria-hidden />
          {save.isPending ? "Saving…" : "Save board"}
        </Button>
      </div>
    </form>
  );
}
/** Distinguish inherited audience rules from explicit denial and per-board author capabilities. */
function PolicyEditor({
  policy,
  onChange,
}: {
  policy: ForumPolicy;
  onChange: (p: ForumPolicy) => void;
}) {
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        <ShieldCheck className="mr-2 inline h-4 w-4" aria-hidden />
        Access policy
      </summary>
      <fieldset className="mt-3">
        <legend className="sr-only">Access policy overrides</legend>
        <p className="text-muted-foreground mb-3 text-xs">
          Inherit uses the parent board, then section policy. Forum staff grants are
          evaluated separately; explicit denies override grants.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["view", "read", "create", "reply", "upload", "vote"] as const).map(
            (key) => (
              <label key={key} className="text-sm">
                {
                  {
                    view: "See board",
                    read: "Read topics",
                    create: "Create topics",
                    reply: "Reply",
                    upload: "Embed media",
                    vote: "React & vote",
                  }[key]
                }
                <select
                  className="bg-background block h-10 w-full rounded-md border px-2"
                  value={policy[key] ?? ""}
                  onChange={(e) => {
                    const next = { ...policy };
                    if (e.target.value)
                      next[key] = e.target.value as NonNullable<
                        ForumPolicy[typeof key]
                      >;
                    else delete next[key];
                    onChange(next);
                  }}
                >
                  <option value="">Inherit</option>
                  {forumAudiences.map((a) => (
                    <option key={a} value={a}>
                      {
                        {
                          PUBLIC: "Everyone",
                          MEMBERS: "Registered players",
                          STAFF: "Game staff",
                          MODERATORS: "Forum moderators",
                          NONE: "Nobody (explicit grants only)",
                        }[a]
                      }
                    </option>
                  ))}
                </select>
              </label>
            ),
          )}
          {(["editOwn", "deleteOwn"] as const).map((key) => (
            <label key={key} className="text-sm">
              {key === "editOwn" ? "Edit own posts" : "Remove own posts"}
              <select
                className="bg-background block h-10 w-full rounded-md border px-2"
                value={policy[key] === undefined ? "" : String(policy[key])}
                onChange={(e) => {
                  const next = { ...policy };
                  if (e.target.value) next[key] = e.target.value === "true";
                  else delete next[key];
                  onChange(next);
                }}
              >
                <option value="">Inherit</option>
                <option value="true">Allow</option>
                <option value="false">Deny</option>
              </select>
            </label>
          ))}
        </div>
      </fieldset>
    </details>
  );
}
/** Require a destination for retained content and surface recoverable server rejections in place. */
function RemoveStructure({
  target,
  data,
  done,
}: {
  target: { type: "BOARD" | "SECTION"; id: string };
  data: Administration;
  done: () => void;
}) {
  const [destinationId, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = api.forum.removeStructure.useMutation();
  const source = (target.type === "BOARD" ? data.boards : data.sections).find(
    (s) => s.id === target.id,
  );
  const count =
    target.type === "BOARD"
      ? (data.boards.find((b) => b.id === target.id)?.nThreads ?? 0)
      : data.boards.filter((b) => b.sectionId === target.id).length;
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (mutation.isPending || reason.trim().length < 3) return;
        setError("");
        try {
          const result = await mutation.mutateAsync({
            ...target,
            destinationId: destinationId || undefined,
            reason,
          });
          showMutationToast(result);
          if (result.success) done();
          else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Container could not be removed");
        }
      }}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <Trash2 className="h-4 w-4" aria-hidden />
        Remove {source?.name}
      </h2>
      <p className="text-sm">
        This contains {count} {target.type === "BOARD" ? "visible topics" : "boards"}.
        Choose where to move its content. Archive from the edit form to keep the
        container and its history.
      </p>
      <label className="block text-sm">
        Destination
        <select
          className="bg-background block h-10 w-full rounded-md border px-2"
          value={destinationId}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="">Remove only if empty</option>
          {(target.type === "BOARD" ? data.boards : data.sections)
            .filter((s) => s.id !== target.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <Reason value={reason} setValue={setReason} />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={mutation.isPending}
          onClick={done}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to boards
        </Button>
        <Button
          variant="destructive"
          className="gap-2"
          disabled={mutation.isPending || reason.trim().length < 3}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {destinationId ? "Move content & remove" : "Remove empty container"}
        </Button>
      </div>
    </form>
  );
}
/** Keep staff-form targets synchronized when the existing player picker selects or clears a player. */
function ForumPlayerSelect({ onSelect }: { onSelect: (id: string) => void }) {
  const { methods: form, users: selected } = useUserPicker();
  const selectedId = selected?.[0]?.userId ?? "";
  useEffect(() => onSelect(selectedId), [onSelect, selectedId]);
  return <UserSearchSelect useFormMethods={form} showYourself showAi maxUsers={1} />;
}
/** Manage scoped grants/denies and inspect the resulting effective permissions for a selected player. */
function ForumStaff({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const fieldPrefix = useId();
  const [userId, setUserId] = useState("");
  const [scope, setScope] = useState<"GLOBAL" | "SECTION" | "BOARD">("BOARD");
  const [scopeId, setScopeId] = useState(data.boards[0]?.id ?? "");
  const [permissions, setPermissions] = useState<(typeof forumCapabilities)[number][]>([
    "moderate",
    "approve",
  ]);
  const [denies, setDenies] = useState<(typeof forumCapabilities)[number][]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const save = api.forum.saveGrant.useMutation();
  const effective = api.forum.effectivePermissions.useQuery(
    { userId },
    { enabled: !!userId },
  );
  const saveDisabledReason = !userId
    ? "Select a player before saving capabilities."
    : scope !== "GLOBAL" && !scopeId
      ? `Select a ${scope === "BOARD" ? "board" : "section"} before saving capabilities.`
      : reason.trim().length < 3
        ? "Enter an audit reason with at least 3 characters."
        : undefined;
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (saveDisabledReason || save.isPending) return;
          try {
            const result = await save.mutateAsync({
              userId,
              scope,
              scopeId: scope === "GLOBAL" ? "*" : scopeId,
              permissions,
              denies,
              reason,
              remove: false,
            });
            showMutationToast(result);
            if (result.success) {
              setReason("");
              await refresh();
            } else setError(result.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Permissions could not be saved");
          }
        }}
      >
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4" aria-hidden />
          Staff permissions
        </h2>
        <p className="text-muted-foreground text-xs">
          Select a player, choose where they can act, then grant or deny capabilities.
        </p>
        <ForumPlayerSelect onSelect={setUserId} />
        {userId && (
          <p className="text-sm">
            Selected: {effective.data?.username ?? "Loading player…"}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Scope
            <select
              className="bg-background block h-10 w-full rounded-md border px-2"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as typeof scope);
                if (e.target.value !== "GLOBAL") {
                  const isScoped = (capability: string) =>
                    !["manage", "purge"].includes(capability);
                  setPermissions((current) => current.filter(isScoped));
                  setDenies((current) => current.filter(isScoped));
                }
                setScopeId(
                  e.target.value === "SECTION"
                    ? (data.sections[0]?.id ?? "")
                    : (data.boards[0]?.id ?? ""),
                );
              }}
            >
              <option value="BOARD">Board</option>
              <option value="SECTION">Section</option>
              <option value="GLOBAL">Whole forum</option>
            </select>
          </label>
          {scope !== "GLOBAL" && (
            <label className="text-sm">
              Location
              <select
                className="bg-background block h-10 w-full rounded-md border px-2"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
              >
                {(scope === "BOARD" ? data.boards : data.sections).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <details className="rounded-md border p-3" open={!!userId}>
          <summary className="cursor-pointer text-sm font-medium">
            <ShieldCheck className="mr-2 inline h-4 w-4" aria-hidden />
            Capabilities
          </summary>
          <p className="text-muted-foreground mt-2 text-xs">
            Unselected capabilities inherit existing access. An explicit deny overrides
            a grant.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Capability</th>
                  <th className="p-2">Grant</th>
                  <th className="p-2">Deny</th>
                </tr>
              </thead>
              <tbody>
                {forumCapabilities
                  .filter((c) => scope === "GLOBAL" || !["manage", "purge"].includes(c))
                  .map((cap) => (
                    <tr key={cap} className="border-t">
                      <td className="p-2">{capabilityLabel(cap)}</td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`Grant ${capabilityLabel(cap)}`}
                          checked={permissions.includes(cap)}
                          onChange={(e) =>
                            setPermissions((p) =>
                              e.target.checked
                                ? [...p, cap]
                                : p.filter((c) => c !== cap),
                            )
                          }
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`Deny ${capabilityLabel(cap)}`}
                          checked={denies.includes(cap)}
                          onChange={(e) =>
                            setDenies((p) =>
                              e.target.checked
                                ? [...p, cap]
                                : p.filter((c) => c !== cap),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
        <Reason value={reason} setValue={setReason} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {saveDisabledReason && (
          <p
            id={`${fieldPrefix}-save-help`}
            role="status"
            className="text-muted-foreground text-sm"
          >
            {saveDisabledReason}
          </p>
        )}
        <div className="flex justify-end border-t pt-3">
          <Button
            type="submit"
            className="gap-2"
            disabled={!!saveDisabledReason || save.isPending}
            aria-describedby={
              saveDisabledReason ? `${fieldPrefix}-save-help` : undefined
            }
            aria-busy={save.isPending}
          >
            <Save className="h-4 w-4" aria-hidden />
            {save.isPending ? "Saving…" : "Save capabilities"}
          </Button>
        </div>
      </form>
      {effective.data && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">
            Effective access for {effective.data.username}
          </summary>
          <p className="text-muted-foreground my-2 text-xs">
            Board policy inherits from its section. Explicit scoped denies win; posting
            restrictions and account state can further limit actions. Site
            administrators keep recovery access.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Board</th>
                  <th className="p-2">Effective capabilities</th>
                </tr>
              </thead>
              <tbody>
                {effective.data.boards.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-2">{b.name}</td>
                    <td className="p-2">
                      {Object.entries(b.permissions)
                        .filter(([key, value]) => value === true && key !== "archived")
                        .map(([key]) => capabilityLabel(key, true))
                        .join(", ") || "No access"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <h2 className="font-semibold">Current assignments ({data.grants.length})</h2>
      {!data.grants.length && (
        <p className="text-muted-foreground text-sm">No explicit staff assignments.</p>
      )}
      {assignmentError && (
        <p role="alert" className="text-destructive text-sm">
          {assignmentError}
        </p>
      )}
      {data.grants.map((g) => (
        <div
          key={g.id}
          className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
        >
          <div className="mr-auto min-w-0 break-words">
            <b>{g.user?.username ?? g.userId}</b>
            <p>
              {g.scope === "GLOBAL"
                ? "Whole forum"
                : (g.scope === "BOARD" ? data.boards : data.sections).find(
                    (s) => s.id === g.scopeId,
                  )?.name}{" "}
              · {g.permissions.map((cap) => capabilityLabel(cap)).join(", ")}
            </p>
            {!!g.denies.length && (
              <p>Deny: {g.denies.map((cap) => capabilityLabel(cap)).join(", ")}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Remove assignment for ${g.user?.username ?? g.userId}`}
            hoverText="Remove assignment"
            disabled={save.isPending}
            onClick={async () => {
              setAssignmentError("");
              try {
                const result = await save.mutateAsync({
                  ...g,
                  remove: true,
                  reason: "Remove forum assignment",
                });
                showMutationToast(result);
                if (result.success) await refresh();
                else setAssignmentError(result.message);
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Assignment could not be removed";
                setAssignmentError(message);
              }
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}
    </div>
  );
}
/** Apply or lift forum-only posting restrictions while retaining inputs after rejected attempts. */
function ForumRestrictions({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const fieldPrefix = useId();
  const [userId, setUserId] = useState("");
  const restrictable = data.boards.filter(
    (board) => data.canManage || board.permissions.moderate,
  );
  const [boardId, setBoardId] = useState(
    data.canManage ? "" : (restrictable[0]?.id ?? ""),
  );
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [liftError, setLiftError] = useState("");
  const save = api.forum.restrict.useMutation();
  const disabledReason = !userId
    ? "Select a player before restricting posting."
    : !data.canManage && !boardId
      ? "Select a board before restricting posting."
      : reason.trim().length < 3
        ? "Enter an audit reason with at least 3 characters."
        : "";
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (save.isPending || disabledReason) return;
          setError("");
          try {
            const r = await save.mutateAsync({
              userId,
              boardId: boardId || null,
              expiresAt: addDays(new Date(), days),
              reason,
              remove: false,
            });
            showMutationToast(r);
            if (r.success) {
              setReason("");
              await refresh();
            } else setError(r.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Restriction could not be saved");
          }
        }}
      >
        <h2 className="flex items-center gap-2 font-semibold">
          <Ban className="h-4 w-4" aria-hidden />
          Restrict posting
        </h2>
        <p className="text-muted-foreground text-sm">
          The player can read permitted boards. Their game account remains active.
        </p>
        <ForumPlayerSelect onSelect={setUserId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Scope
            <select
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              className="bg-background block h-10 w-full rounded-md border px-2"
            >
              {data.canManage && <option value="">Whole forum</option>}
              {restrictable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm" htmlFor={`${fieldPrefix}-10`}>
            Duration in days
            <NumberInput
              id={`${fieldPrefix}-10`}
              value={days}
              min={1}
              max={90}
              onValueChange={setDays}
            />
          </label>
        </div>
        <Reason value={reason} setValue={setReason} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {disabledReason && (
          <p
            id={`${fieldPrefix}-hint`}
            role="status"
            className="text-muted-foreground text-sm"
          >
            {disabledReason}
          </p>
        )}
        <div className="flex justify-end border-t pt-3">
          <Button
            className="gap-2"
            disabled={!!disabledReason || save.isPending}
            aria-busy={save.isPending}
            aria-describedby={disabledReason ? `${fieldPrefix}-hint` : undefined}
          >
            <Ban className="h-4 w-4" aria-hidden />
            {save.isPending ? "Saving…" : "Restrict posting"}
          </Button>
        </div>
      </form>
      <h2 className="font-semibold">
        Current restrictions ({data.restrictions.length})
      </h2>
      {liftError && (
        <p role="alert" className="text-destructive text-sm">
          {liftError}
        </p>
      )}
      {!data.restrictions.length && (
        <p className="text-muted-foreground text-sm">No restrictions in your scope.</p>
      )}
      {data.restrictions.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
        >
          <div className="mr-auto min-w-0 break-words">
            <b>{r.user?.username ?? r.userId}</b>
            <p>{r.reason}</p>
            <p className="text-muted-foreground text-xs" suppressHydrationWarning>
              {r.boardId
                ? data.boards.find((b) => b.id === r.boardId)?.name
                : "Whole forum"}{" "}
              · expires {r.expiresAt.toLocaleString()}
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-2"
            variant="outline"
            disabled={save.isPending}
            onClick={async () => {
              setLiftError("");
              try {
                const result = await save.mutateAsync({ ...r, remove: true });
                showMutationToast(result);
                if (result.success) await refresh();
                else setLiftError(result.message);
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Restriction could not be lifted";
                setLiftError(message);
              }
            }}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Lift restriction
          </Button>
        </div>
      ))}
    </div>
  );
}
/** Keep approvals and recovery compact; reported-content decisions belong in Player reports. */
function ForumApprovals({
  data,
  refresh,
}: {
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const itemCount = data.threads.length + data.posts.length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            Approvals & recovery
          </h2>
          <p className="text-muted-foreground text-xs">
            {itemCount} {itemCount === 1 ? "item" : "items"} on this page
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/reports">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Player reports
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Approve unpublished content or restore removed content here. Reported content is
        handled in Player reports.
      </p>
      {data.threads.length > 0 && (
        <section
          className="space-y-2"
          aria-label="Topics awaiting approval or recovery"
        >
          <h3 className="text-sm font-semibold">Topics ({data.threads.length})</h3>
          {selected.length > 0 && (
            <ForumTopicTools
              ids={selected}
              onlyApprove={
                !selected.every(
                  (id) =>
                    data.boards.find(
                      (b) => b.id === data.threads.find((t) => t.id === id)?.boardId,
                    )?.permissions.moderate,
                )
              }
              onDone={() => setSelected([])}
            />
          )}
          {data.threads.map((thread) => (
            <div key={thread.id} className="rounded-md border">
              <label className="flex cursor-pointer items-start gap-3 p-3 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={selected.includes(thread.id)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, thread.id]
                        : current.filter((id) => id !== thread.id),
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  <b>{thread.title}</b>
                  <span className="text-muted-foreground block text-xs">
                    {data.boards.find((b) => b.id === thread.boardId)?.name} ·{" "}
                    {thread.deletedAt ? "Removed" : "Awaiting approval"}
                  </span>
                </span>
              </label>
              {thread.deletedAt &&
                data.boards.find((b) => b.id === thread.boardId)?.permissions.purge && (
                  <div className="px-3 pb-3">
                    <PurgeTopic thread={thread} done={refresh} />
                  </div>
                )}
            </div>
          ))}
        </section>
      )}
      {data.posts.length > 0 && (
        <section className="space-y-2" aria-label="Posts awaiting approval or recovery">
          <h3 className="text-sm font-semibold">Posts ({data.posts.length})</h3>
          {data.posts.map((entry) => (
            <ForumPostApproval
              key={entry.post.id}
              entry={entry}
              data={data}
              refresh={refresh}
            />
          ))}
        </section>
      )}
      {!data.threads.length && !data.posts.length && (
        <p className="rounded-md border p-6 text-sm">
          No content awaiting approval or recovery on this page.
        </p>
      )}
    </div>
  );
}

/** Keep publication and recovery actions beside the post, preserving rejected edits for retry. */
function ForumPostApproval({
  entry: { post, thread },
  data,
  refresh,
}: {
  entry: Administration["posts"][number];
  data: Administration;
  refresh: () => Promise<void>;
}) {
  const fieldPrefix = useId();
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const moderate = api.forum.moderatePost.useMutation();
  const board = data.boards.find((b) => b.id === thread.boardId);
  const actions = [
    ...(!post.isApproved && thread.isApproved && board?.permissions.approve
      ? (["APPROVE"] as const)
      : []),
    ...(post.deletedAt && board?.permissions.moderate ? (["RESTORE"] as const) : []),
    ...(!post.deletedAt && board?.permissions.removeOthers
      ? (["REMOVE"] as const)
      : []),
  ];
  const labels = {
    APPROVE: "Approve post",
    RESTORE: "Restore post",
    REMOVE: "Remove post",
  };
  const selectedAction = actions.find((value) => value === action) ?? actions[0];
  const isPending = moderate.isPending;
  const disabledReason =
    reason.trim().length < 3 ? "Enter an audit reason with at least 3 characters." : "";
  return (
    <details className="group overflow-hidden rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold break-words">{thread.title}</span>
          <span className="text-muted-foreground block text-xs">{board?.name}</span>
        </span>
        <span className="bg-muted shrink-0 rounded px-2 py-1 text-xs">
          {post.deletedAt ? "Removed" : "Needs approval"}
        </span>
      </summary>
      <div className="space-y-3 border-t p-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <Link
            href={`/forum/${thread.boardId}/${thread.id}?post=${post.id}`}
            className="underline"
          >
            View discussion
          </Link>
        </div>
        <details className="group/post text-sm">
          <summary aria-label="Read full post" className="cursor-pointer">
            <span className="font-medium">Read full post</span>
            <div className="mt-2 line-clamp-3 break-words group-open/post:hidden">
              {parseHtml(post.content)}
            </div>
          </summary>
          <div className="mt-2 break-words">{parseHtml(post.content)}</div>
        </details>
        {post.removalReason && (
          <p className="text-muted-foreground text-xs break-words">
            Removal reason: {post.removalReason}
          </p>
        )}
        {selectedAction && (
          <form
            className="bg-muted/30 space-y-3 rounded-md border p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (isPending || disabledReason) return;
              setError("");
              try {
                const result = await moderate.mutateAsync({
                  postId: post.id,
                  action: selectedAction,
                  reason,
                });
                showMutationToast(result);
                if (result.success) {
                  setReason("");
                  await refresh();
                } else setError(result.message);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "The change could not be saved.",
                );
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor={`${fieldPrefix}-action`} className="block text-sm">
                Action
                <select
                  id={`${fieldPrefix}-action`}
                  className="bg-background block h-9 w-full rounded-md border px-2"
                  value={selectedAction}
                  disabled={isPending}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setError("");
                  }}
                >
                  {actions.map((value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <Reason value={reason} setValue={setReason} />
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              {disabledReason && (
                <p
                  id={`${fieldPrefix}-hint`}
                  role="status"
                  className="text-muted-foreground mr-auto text-xs"
                >
                  {disabledReason}
                </p>
              )}
              <Button
                type="submit"
                size="sm"
                className="gap-2"
                variant={selectedAction === "REMOVE" ? "destructive" : "default"}
                disabled={!!disabledReason || isPending}
                aria-busy={isPending}
                aria-describedby={disabledReason ? `${fieldPrefix}-hint` : undefined}
              >
                {selectedAction === "REMOVE" ? (
                  <Trash2 className="h-4 w-4" aria-hidden />
                ) : selectedAction === "RESTORE" ? (
                  <RotateCcw className="h-4 w-4" aria-hidden />
                ) : (
                  <Check className="h-4 w-4" aria-hidden />
                )}
                {isPending ? "Saving…" : labels[selectedAction]}
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
/** Give audit-reason inputs stable accessible labels across independently mounted staff forms. */
function Reason({
  value,
  setValue,
}: {
  value: string;
  setValue: (value: string) => void;
}) {
  const fieldPrefix = useId();
  return (
    <label className="block text-sm" htmlFor={`${fieldPrefix}-11`}>
      Reason for the audit log
      <Input
        id={`${fieldPrefix}-11`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        minLength={3}
        maxLength={500}
        placeholder="Explain the change"
      />
    </label>
  );
}

/** Gate permanent removal behind explicit permission, exact-title confirmation and an audit reason. */
function PurgeTopic({
  thread,
  done,
}: {
  thread: Administration["threads"][number];
  done: () => Promise<void>;
}) {
  const fieldPrefix = useId();
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = api.forum.purgeTopic.useMutation();
  return (
    <details className="border-destructive rounded-md border p-3">
      <summary className="text-destructive cursor-pointer text-sm font-semibold">
        Permanently purge “{thread.title}”
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const result = await mutation.mutateAsync({
              threadId: thread.id,
              confirmTitle: title,
              reason,
            });
            showMutationToast(result);
            if (result.success) await done();
            else setError(result.message);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Purge failed.");
          }
        }}
      >
        <p className="text-sm">
          This permanently removes the topic, posts and revisions. The audit record
          remains. This action cannot be undone.
        </p>
        <label htmlFor={`${fieldPrefix}-title`} className="block text-sm">
          Type the exact topic title
          <Input
            id={`${fieldPrefix}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <Reason value={reason} setValue={setReason} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          variant="destructive"
          className="gap-2"
          disabled={
            mutation.isPending || title !== thread.title || reason.trim().length < 3
          }
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Permanently purge topic
        </Button>
      </form>
    </details>
  );
}

/** Distinguish author-only edit/remove policy from delegated moderation capabilities in staff labels. */
function capabilityLabel(capability: string, effective = false) {
  const labels: Record<string, string> = {
    view: "See boards",
    read: "Read topics",
    create: "Create topics",
    reply: "Reply",
    upload: "Embed media",
    vote: "React & vote",
    edit: effective ? "Edit own posts" : "Edit any post",
    remove: effective ? "Remove own posts" : "Remove any post",
    editOthers: "Edit others' posts",
    removeOthers: "Remove others' posts",
    moderate: "Moderate discussions",
    approve: "Approve posts",
    manage: "Manage forum",
    purge: "Permanently purge removed content",
  };
  return labels[capability] ?? capability;
}

type Administration = NonNullable<RouterOutputs["forum"]["administration"]>;
