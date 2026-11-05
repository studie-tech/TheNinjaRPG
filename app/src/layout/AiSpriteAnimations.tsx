"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useFormState, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { SPRITE_ANIMATION_LIMITS } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
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
  // Undefined follows the saved binding; an empty string explicitly previews clearing it.
  const [candidateId, setCandidateId] = useState<string>();
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
        await utils.spriteAnimation.getAiConfig.invalidate();
        if ("id" in result) setCandidateId(result.id);
      }
    },
  });
  const assign = api.spriteAnimation.assign.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await utils.spriteAnimation.getAiConfig.invalidate({ userId });
        setCandidateId(undefined);
      }
    },
  });
  const data = config.data;
  const bindings = new Map(
    data?.assignments.map((assignment) => [
      assignment.actionKey,
      assignment.animationId,
    ]),
  );
  const savedId = bindings.get(actionKey) ?? "";
  const selectionId = candidateId ?? savedId;
  const hasChanges = selectionId !== savedId;
  const animationId =
    selectionId || (actionKey !== "idle" ? bindings.get("idle") : undefined);
  const preview = data?.animations.find((animation) => animation.id === animationId);

  return (
    <ContentBox
      title="Sprite animations"
      subtitle="Idle, movement and action-specific character sprites"
      initialBreak
    >
      <p className="mb-3 text-sm">
        Unassigned actions use Idle. If Idle is unassigned, the current character image
        is shown. Preview a selection, then apply it to new battles.
      </p>
      {config.isPending && <p>Loading animation assignments…</p>}
      {config.error && (
        <div role="alert">
          <p>{config.error.message}</p>
          <Button onClick={() => void config.refetch()}>Retry</Button>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-[minmax(0,1fr)_128px] gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="min-w-0 space-y-3">
            <div>
              <Label htmlFor="sprite-action">Action</Label>
              <select
                id="sprite-action"
                className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm"
                value={actionKey}
                disabled={assign.isPending}
                onChange={(event) => {
                  setActionKey(event.target.value);
                  setCandidateId(undefined);
                  assign.reset();
                }}
              >
                {[...groupBy(data.actions, "group")].map(([group, actions]) => (
                  <optgroup key={group} label={group}>
                    {actions.map((action) => (
                      <option key={action.key} value={action.key}>
                        {action.name}
                        {bindings.has(action.key) ? " (assigned)" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="sprite-selection">Animation</Label>
              <select
                id="sprite-selection"
                className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm"
                value={selectionId}
                disabled={assign.isPending}
                onChange={(event) => {
                  setCandidateId(event.target.value);
                  assign.reset();
                }}
              >
                <option value="">
                  {actionKey === "idle" ? "Current image" : "Default (idle → image)"}
                </option>
                {data.animations.map((animation) => (
                  <option key={animation.id} value={animation.id}>
                    {animation.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!hasChanges || assign.isPending}
                onClick={() =>
                  assign.mutate({
                    userId,
                    actionKey,
                    animationId: selectionId || null,
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
                    setCandidateId(undefined);
                    assign.reset();
                  }}
                >
                  Reset
                </Button>
              )}
              {preview && (
                <Button
                  type="button"
                  variant="outline"
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
              <p role="alert" className="text-destructive text-sm">
                {assign.error.message}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="mb-2 font-semibold text-sm">Preview</p>
            {preview ? (
              <SpriteAnimationPreview key={preview.id} animation={preview} />
            ) : (
              <p className="text-muted-foreground text-sm">
                Uses the current character image.
              </p>
            )}
            {preview && (
              <p className="mt-2 text-muted-foreground text-xs">
                {preview.frameCount} frames · {preview.fps} fps · faces {preview.facing}
                {!selectionId && actionKey !== "idle" && " · uses Idle"}
              </p>
            )}
          </div>
        </div>
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
          seconds per loop. Battles request 128- or 256-pixel cells to match the
          displayed size. Keep transparency and frame padding consistent throughout the
          loop; the first frame establishes the feet position. Upload replacements as
          new files so browsers can cache each version independently. Uploaded sheets
          use CDN resizing; external URLs need 128-pixel cells for mobile. New sheets
          stay in the library when assignments change.
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
                animation={{ ...draftPreview.data, id: "draft" }}
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

/**
 * Preview the unchanged row-major atlas without cropping or resizing its source cells.
 * Key by sheet identity or draft metadata to reset frame and load-error state on edits.
 */
export const SpriteAnimationPreview = ({
  animation,
}: {
  animation: CharacterAnimation;
}) => {
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % animation.frameCount),
      1000 / animation.fps,
    );
    return () => window.clearInterval(timer);
  }, [animation.frameCount, animation.fps]);
  return (
    <div
      className="relative aspect-square overflow-hidden rounded-md border bg-muted"
      role="img"
      aria-label={animation.name}
    >
      {error ? (
        <p role="alert" className="p-3 text-sm">
          Sprite sheet could not be loaded. Check the image URL.
        </p>
      ) : (
        // biome-ignore lint/performance/noImgElement: Atlas UV previews must load the full unchanged sheet.
        <img
          src={animation.url}
          alt=""
          onError={() => setError(true)}
          className="absolute max-w-none"
          style={{
            width: `${animation.columns * 100}%`,
            height: `${animation.rows * 100}%`,
            left: `${-(frame % animation.columns) * 100}%`,
            top: `${-Math.floor(frame / animation.columns) * 100}%`,
            imageRendering: "pixelated",
          }}
        />
      )}
    </div>
  );
};
