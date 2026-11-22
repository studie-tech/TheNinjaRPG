"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { nanoid } from "nanoid";
import type { RefObject } from "react";
import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SPLASH_MAX_VISIBLE } from "@/drizzle/constants";
import type { SplashAnnouncement } from "@/drizzle/schema";
import { useSplashMutations } from "@/hooks/useSplash";
import ContentBox from "@/layout/ContentBox";
import ContentImageSelector from "@/layout/ContentImageSelector";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { SuggestChange } from "@/layout/SuggestChange";
import { WelcomeBoard } from "@/layout/WelcomeBoard";
import { WelcomeDialog } from "@/layout/WelcomeDialog";
import {
  isSplashActive,
  splashEditable,
  visibleSplashAnnouncements,
} from "@/libs/splash";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type SplashFormInput,
  type SplashInput,
  splashSchema,
} from "@/validators/splash";

export default function SplashEditorPage() {
  const { data: user } = useRequiredUserData();
  const allowed = canChangeContent(user?.role ?? "USER");
  const query = api.splash.getForEdit.useQuery(undefined, { enabled: allowed });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [editing, setEditing] = useState<{ entry?: SplashAnnouncement }>();
  const [message, setMessage] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewToggleRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement>(null);
  const mutations = useSplashMutations({
    onSuccess: (result, createdId) => {
      setMessage(result.success && createdId ? "Announcement created" : result.message);
      if (result.success) setEditing(undefined);
    },
    onError: (error) => setMessage(error.message),
  });
  const pending =
    mutations.create.isPending ||
    mutations.update.isPending ||
    mutations.setEnabled.isPending;
  const entries = query.data ?? [];
  const term = search.trim().toLowerCase();
  const filtered = entries.filter(
    (entry) =>
      (filter === "all" || entry.enabled === (filter === "enabled")) &&
      (!term ||
        [entry.name, entry.description, entry.topicKey, entry.href].some((value) =>
          value.toLowerCase().includes(term),
        )),
  );
  const preview = visibleSplashAnnouncements(entries);
  if (!allowed) return <p>Only content staff can manage announcements.</p>;
  if (query.isPending) return <Loader explanation="Loading announcements" />;
  if (query.isError)
    return (
      <p role="alert">
        Could not load announcements.{" "}
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </p>
    );
  return (
    <ContentBox
      title="Welcome board"
      subtitle="Manage individual announcements alongside daily rewards"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-sm">
            The {SPLASH_MAX_VISIBLE} highest-priority live entries appear in the welcome
            dialog. Disable old updates to retain their topic history for the reviewer.{" "}
            <Link className="underline" href="/manual/review">
              Review suggestions
            </Link>
            .
          </p>
          <div className="flex items-center gap-3">
            <Switch
              id="splash-preview"
              ref={previewToggleRef}
              checked={previewOpen}
              onCheckedChange={setPreviewOpen}
            />
            <Label htmlFor="splash-preview">
              Preview splash screen ({preview.length}/{SPLASH_MAX_VISIBLE})
            </Label>
          </div>
          <Button
            onClick={(event) => {
              returnFocusRef.current = event.currentTarget;
              setMessage(undefined);
              setEditing({});
            }}
          >
            Create announcement
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="announcement-search">Search announcements</Label>
            <Input
              id="announcement-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, topic or destination"
            />
          </div>
          <div>
            <Label htmlFor="announcement-filter">Status</Label>
            <select
              id="announcement-filter"
              className="bg-background h-9 rounded border px-2 text-sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">All entries</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>
        {message && !editing && <p role="status">{message}</p>}
        <div className="space-y-3">
          {filtered.map((entry) => (
            <article
              key={entry.id}
              className="flex flex-col justify-between gap-3 rounded border p-3 sm:flex-row"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="max-w-full font-bold break-words">{entry.name}</h2>
                  <Badge variant={entry.enabled ? "default" : "secondary"}>
                    {entry.enabled
                      ? isSplashActive(entry)
                        ? "Live"
                        : entry.endsAt && entry.endsAt <= new Date()
                          ? "Expired"
                          : "Scheduled"
                      : "Disabled"}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    Priority {entry.priority}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs break-all">
                  {entry.topicKey} · {entry.href}
                </p>
                <p className="line-clamp-2 text-sm break-words">{entry.description}</p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    setMessage(undefined);
                    setEditing({ entry });
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    mutations.setEnabled.mutate({
                      id: entry.id,
                      enabled: !entry.enabled,
                    })
                  }
                >
                  {entry.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <p className="rounded border border-dashed p-5 text-sm">
              {entries.length
                ? "No announcements match these filters."
                : "Create an announcement to add news to the welcome dialog. Daily rewards remain available."}
            </p>
          )}
        </div>
        {previewOpen && (
          <WelcomeDialog
            announcements={preview}
            onClose={() => setPreviewOpen(false)}
            onDismissForToday={() => setPreviewOpen(false)}
            returnFocusRef={previewToggleRef}
          />
        )}
        {editing && (
          <AnnouncementEditor
            key={editing.entry?.id ?? "new"}
            entry={editing.entry}
            pending={pending}
            message={message}
            returnFocusRef={returnFocusRef}
            onClose={() => setEditing(undefined)}
            onSave={(data, id) => {
              setMessage(undefined);
              if (editing.entry)
                mutations.update.mutate({ id: editing.entry.id, data });
              else mutations.create.mutate({ id, data });
            }}
          />
        )}
      </div>
    </ContentBox>
  );
}

function AnnouncementEditor({
  entry,
  pending,
  message,
  returnFocusRef,
  onClose,
  onSave,
}: {
  entry?: SplashAnnouncement;
  pending: boolean;
  message?: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSave: (data: SplashInput, id: string) => void;
}) {
  const [imageRelationId] = useState(() => entry?.id ?? nanoid());
  const form = useForm<SplashFormInput, unknown, SplashInput>({
    resolver: zodResolver(splashSchema),
    defaultValues: entry
      ? splashEditable(entry)
      : {
          topicKey: "",
          name: "",
          description: "",
          image: "",
          href: "/profile",
          linkLabel: "Learn more",
          priority: 0,
          enabled: false,
          startsAt: null,
          endsAt: null,
        },
  });
  const values = useWatch({ control: form.control });
  const preview = splashSchema.safeParse(values);
  const errors = form.formState.errors;
  return (
    <Modal
      title={entry ? `Edit ${entry.name}` : "Create announcement"}
      isOpen
      setIsOpen={(open) => {
        if (!open) onClose();
      }}
      isLoading={pending}
      returnFocusRef={returnFocusRef}
      className="max-w-3xl"
      bodyClassName="space-y-4 py-2"
      footerExtra={
        <Button type="submit" form="announcement-editor" disabled={pending}>
          {pending ? "Saving…" : "Save announcement"}
        </Button>
      }
    >
      <form
        id="announcement-editor"
        onSubmit={form.handleSubmit((data) => onSave(data, imageRelationId))}
        className="space-y-3"
      >
        <fieldset disabled={pending} className="space-y-3">
          {(
            ["name", "topicKey", "description", "image", "href", "linkLabel"] as const
          ).map((field) => (
            <div key={field}>
              <Label htmlFor={`announcement-${field}`}>
                {
                  {
                    name: "Title",
                    topicKey: "Topic key",
                    description: "Text",
                    image: "Image URL (optional, game CDN)",
                    href: "Game destination",
                    linkLabel: "Link text",
                  }[field]
                }
              </Label>
              {field === "image" ? (
                <Controller
                  control={form.control}
                  name="image"
                  render={({ field: imageField }) => (
                    <div className="space-y-2">
                      <ContentImageSelector
                        label="Announcement image"
                        imageUrl={imageField.value || null}
                        id={imageRelationId}
                        prompt={`Welcome announcement: ${values.name ?? ""}. ${values.description ?? ""}`}
                        allowImageUpload
                        emptyImageLabel="Generate or upload announcement artwork"
                        type="splash"
                        size="portrait"
                        maxDim={512}
                        disabled={pending}
                        onUploadComplete={imageField.onChange}
                      />
                      <Input id="announcement-image" {...imageField} />
                      {imageField.value && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() => imageField.onChange("")}
                        >
                          Remove image
                        </Button>
                      )}
                    </div>
                  )}
                />
              ) : field === "description" ? (
                <Textarea
                  id={`announcement-${field}`}
                  {...form.register(field)}
                  maxLength={600}
                />
              ) : (
                <Input
                  id={`announcement-${field}`}
                  {...form.register(field)}
                  readOnly={field === "topicKey" && !!entry}
                />
              )}
              {field === "topicKey" && (
                <p className="text-muted-foreground text-xs">
                  A stable topic such as tower-defense-release. Disabled topics remain
                  archived.
                </p>
              )}
              {errors[field]?.message && (
                <p role="alert" className="text-destructive text-sm">
                  {errors[field]?.message}
                </p>
              )}
            </div>
          ))}
          <div>
            <Label htmlFor="announcement-priority">
              Priority (higher appears first)
            </Label>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <NumberInput
                  id="announcement-priority"
                  {...field}
                  min={-1000}
                  max={1000}
                  step={1}
                  onValueChange={field.onChange}
                />
              )}
            />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" {...form.register("enabled")} /> Enabled
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["startsAt", "endsAt"] as const).map((field) => (
              <div key={field}>
                <Label htmlFor={`announcement-${field}`}>
                  {field === "startsAt" ? "Start" : "End"} (UTC, optional)
                </Label>
                <Controller
                  control={form.control}
                  name={field}
                  render={({ field: input }) => (
                    <Input
                      id={`announcement-${field}`}
                      type="datetime-local"
                      ref={input.ref}
                      name={input.name}
                      onBlur={input.onBlur}
                      value={input.value?.slice(0, 16) ?? ""}
                      onChange={(event) =>
                        input.onChange(
                          event.target.value ? `${event.target.value}:00.000Z` : null,
                        )
                      }
                    />
                  )}
                />
                {errors[field]?.message && (
                  <p role="alert" className="text-destructive text-sm">
                    {errors[field]?.message}
                  </p>
                )}
              </div>
            ))}
          </div>
          {entry && (
            <SuggestChange
              entityType="SPLASH"
              entityId={entry.id}
              getData={() => {
                const result = splashSchema.safeParse(form.getValues());
                return result.success ? result.data : null;
              }}
            />
          )}
        </fieldset>
      </form>
      {message && <p role="status">{message}</p>}
      {preview.success && (
        <WelcomeBoard
          announcements={[{ ...preview.data, id: entry?.id ?? "preview" }]}
        />
      )}
    </Modal>
  );
}
