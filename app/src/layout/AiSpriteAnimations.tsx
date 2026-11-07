"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useForm, useFormState, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { SPRITE_ANIMATION_LIMITS } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { SpriteSheetPicker } from "@/layout/SpriteSheetPicker";
import { SpriteAnimationPreview, SpriteSheetFrame } from "@/layout/SpriteSheetPreview";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import { showMutationToast } from "@/libs/toast";
import { groupBy } from "@/utils/grouping";
import { UploadButton } from "@/utils/uploadthing";
import {
  type SpriteAnimationInput,
  spriteAnimationSchema,
} from "@/validators/spriteAnimation";

const emptyAnimation: SpriteAnimationInput = {
  name: "",
  url: "",
  columns: 6,
  rows: 4,
  frameCount: 24,
  fps: 12.5,
  facing: "left",
};

/** Edit one AI's bindings and shared sheets independently of the parent AI form draft. */
export const AiSpriteAnimations = ({ userId }: { userId: string }) => {
  const utils = api.useUtils();
  const config = api.spriteAnimation.getAiConfig.useQuery({ userId });
  const [actionKey, setActionKey] = useState("idle");
  // Undefined follows the saved binding; null explicitly previews clearing it.
  const [candidate, setCandidate] = useState<CharacterAnimation | null>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [revisionName, setRevisionName] = useState<string>();
  const form = useForm<SpriteAnimationInput>({
    resolver: zodResolver(spriteAnimationSchema),
    defaultValues: emptyAnimation,
  });
  const { errors } = useFormState({ control: form.control });
  const draft = useWatch({ control: form.control });
  // An unnamed draft can be inspected, but creation still requires the resolver's name.
  const draftPreview = spriteAnimationSchema.safeParse({
    ...draft,
    name: draft.name || "New animation",
  });
  const create = api.spriteAnimation.create.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        form.reset(emptyAnimation);
        setRevisionName(undefined);
        setEditorOpen(false);
        await utils.spriteAnimation.search.invalidate();
        if ("animation" in result) setCandidate(result.animation);
      }
    },
  });
  const assign = api.spriteAnimation.assign.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          utils.spriteAnimation.getAiConfig.invalidate({ userId }),
          utils.spriteAnimation.search.invalidate(),
        ]);
        setCandidate(undefined);
      }
    },
  });
  const data = config.data;
  const sheetFor = (key: string) => {
    const id = data?.assignments.find((entry) => entry.actionKey === key)?.animationId;
    return data?.animations.find((animation) => animation.id === id);
  };
  const saved = sheetFor(actionKey);
  const idle = sheetFor("idle");
  const selection = candidate === undefined ? saved : (candidate ?? undefined);
  const hasChanges = selection?.id !== saved?.id;
  const preview = selection ?? (actionKey !== "idle" ? idle : undefined);
  const studioHref = `/manual/sprite_studio?ai=${encodeURIComponent(userId)}&action=${encodeURIComponent(actionKey)}`;

  return (
    <ContentBox
      title="Sprite animations"
      subtitle="Choose the sheet each action plays in new battles"
      initialBreak
    >
      {config.isPending && <p>Loading animation assignments…</p>}
      {config.error && (
        <div role="alert">
          <p>{config.error.message}</p>
          <Button onClick={() => void config.refetch()}>Retry</Button>
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="max-h-96 min-w-0 space-y-3 overflow-y-auto pr-1">
              {[...groupBy(data.actions, "group")].map(([group, actions]) => (
                <section key={group} aria-label={group}>
                  <h3 className="mb-1 font-semibold text-muted-foreground text-xs uppercase">
                    {group}
                  </h3>
                  <ul className="space-y-1">
                    {actions.map((action) => {
                      const sheet = sheetFor(action.key);
                      const shown = sheet ?? (action.key === "idle" ? undefined : idle);
                      return (
                        <li key={action.key}>
                          <button
                            type="button"
                            aria-pressed={action.key === actionKey}
                            disabled={assign.isPending}
                            className="flex w-full items-center gap-2 rounded-md border border-transparent p-1 text-left hover:bg-muted aria-pressed:border-primary aria-pressed:bg-muted"
                            onClick={() => {
                              setActionKey(action.key);
                              setCandidate(undefined);
                              assign.reset();
                            }}
                          >
                            <span
                              className={`size-9 shrink-0 overflow-hidden rounded-sm border bg-background ${sheet ? "" : "opacity-40"}`}
                            >
                              {shown && <SpriteSheetFrame animation={shown} />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-sm">
                                {action.name}
                              </span>
                              <span className="block truncate text-muted-foreground text-xs">
                                {sheet
                                  ? sheet.name
                                  : action.key === "idle"
                                    ? "Character image"
                                    : "Uses Idle"}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <div className="mx-auto w-full min-w-0 max-w-52 sm:max-w-none">
              {preview ? (
                <SpriteAnimationPreview key={preview.id} animation={preview} />
              ) : (
                <p className="flex aspect-square items-center justify-center rounded-md border bg-muted p-3 text-center text-muted-foreground text-sm">
                  Uses the current character image.
                </p>
              )}
              {preview && (
                <p className="mt-2 text-muted-foreground text-xs">
                  {preview.frameCount} frames · {preview.fps} fps · faces{" "}
                  {preview.facing}
                  {!selection && actionKey !== "idle" && " · uses Idle"}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!hasChanges || assign.isPending}
                  onClick={() =>
                    assign.mutate({
                      userId,
                      actionKey,
                      animationId: selection?.id ?? null,
                    })
                  }
                >
                  {assign.isPending ? "Saving…" : "Apply"}
                </Button>
                {hasChanges && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={assign.isPending}
                    onClick={() => {
                      setCandidate(undefined);
                      assign.reset();
                    }}
                  >
                    Reset
                  </Button>
                )}
                {selection && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={assign.isPending}
                    onClick={() => {
                      setCandidate(null);
                      assign.reset();
                    }}
                  >
                    Remove sheet
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href={studioHref}>
                    <Sparkles className="mr-1 size-4" />
                    Create with Sprite Studio
                  </Link>
                </Button>
                {preview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={create.isPending}
                    onClick={() => {
                      form.reset({
                        name: `${preview.name.slice(0, 180)} (revision)`,
                        url: preview.url,
                        columns: preview.columns,
                        rows: preview.rows,
                        frameCount: preview.frameCount,
                        fps: preview.fps,
                        facing: preview.facing,
                      });
                      create.reset();
                      setRevisionName(preview.name);
                      setEditorOpen(true);
                    }}
                  >
                    Edit as new version
                  </Button>
                )}
              </div>
              {assign.error && (
                <p role="alert" className="mt-2 text-destructive text-sm">
                  {assign.error.message}
                </p>
              )}
            </div>
          </div>
          <SpriteSheetPicker
            userId={userId}
            aiName={data.username}
            selectedId={selection?.id}
            savedId={saved?.id}
            studioHref={studioHref}
            onSelect={(sheet) => {
              setCandidate(sheet);
              assign.reset();
            }}
          />
        </>
      )}
      <details
        className="mt-5 rounded-md border p-3"
        open={editorOpen}
        onToggle={(event) => setEditorOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-semibold text-sm">
          {revisionName ? `Revise ${revisionName}` : "Add a sprite animation"}
        </summary>
        {revisionName && (
          <p className="mt-3 text-sm">
            Change the sheet, grid, timing or facing, then save a new version. Preview
            and Apply it to the chosen action. Other assignments and battles already in
            progress keep their existing version.
          </p>
        )}
        <p className="my-3 text-muted-foreground text-sm">
          Upload a transparent sheet with equal square cells, read left to right, then
          top to bottom. Use at most {SPRITE_ANIMATION_LIMITS.frames} frames,{" "}
          {SPRITE_ANIMATION_LIMITS.cells} cells and {SPRITE_ANIMATION_LIMITS.seconds}{" "}
          seconds per loop. Upload one sheet at any resolution; saving prepares the 128-
          and 256-pixel versions battles use. Keep transparency and frame padding
          consistent throughout the loop; the first frame establishes the feet position.
          Upload replacements as new files so browsers can cache each version
          independently. New sheets stay in the library when assignments change.
        </p>
        <form
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          className="space-y-3"
        >
          {(
            [
              ["name", "Name"],
              ["url", "Sprite sheet URL"],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={`sprite-${field}`}>{label}</Label>
              <Input id={`sprite-${field}`} {...form.register(field)} />
              {errors[field] && (
                <p role="alert" className="text-destructive text-xs">
                  {errors[field]?.message}
                </p>
              )}
            </div>
          ))}
          <UploadButton
            endpoint="spriteAnimationUploader"
            onClientUploadComplete={(files) => {
              const result = files?.[0]?.serverData;
              if (result?.error)
                showMutationToast({ success: false, message: result.error });
              else if (result?.fileUrl)
                form.setValue("url", result.fileUrl, { shouldValidate: true });
            }}
            onUploadError={(error) =>
              showMutationToast({ success: false, message: error.message })
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["columns", "Columns"],
                ["rows", "Rows"],
                ["frameCount", "Frames"],
                ["fps", "Frames / second"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={`sprite-${field}`}>{label}</Label>
                <NumberInput
                  id={`sprite-${field}`}
                  step={field === "fps" ? "0.1" : "1"}
                  {...form.register(field)}
                />
                {errors[field] && (
                  <p role="alert" className="text-destructive text-xs">
                    {errors[field]?.message}
                  </p>
                )}
              </div>
            ))}
          </div>
          <Label htmlFor="sprite-facing">Source facing</Label>
          <select
            id="sprite-facing"
            className="ml-3 rounded-md border bg-background p-2 text-sm"
            {...form.register("facing")}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
          {draftPreview.success && (
            <div className="w-40 max-w-full">
              <p className="mb-2 font-semibold text-sm">Draft preview</p>
              <SpriteAnimationPreview
                key={JSON.stringify(draftPreview.data)}
                animation={{ ...draftPreview.data, id: "draft", smallUrl: null }}
              />
            </div>
          )}
          {create.error && (
            <p role="alert" className="text-destructive text-sm">
              {create.error.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending
                ? "Saving…"
                : revisionName
                  ? "Save new version"
                  : "Add to animation library"}
            </Button>
            {revisionName && (
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => {
                  form.reset(emptyAnimation);
                  create.reset();
                  setRevisionName(undefined);
                  setEditorOpen(false);
                }}
              >
                Cancel revision
              </Button>
            )}
          </div>
        </form>
      </details>
    </ContentBox>
  );
};
