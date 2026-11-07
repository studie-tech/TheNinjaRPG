"use client";

import {
  Check,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type AvatarFacing, AvatarFacings } from "@/drizzle/constants";
import { useSpriteStudio } from "@/hooks/useSpriteStudio";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { Modal } from "@/layout/Modal";
import { SearchSelect } from "@/layout/SearchSelect";
import { SpriteAnimationPreview } from "@/layout/SpriteSheetPreview";
import {
  isSpriteGenerationActive,
  presetForAction,
  type SpriteBodyPlan,
  SpriteBodyPlans,
  SpriteCharacterStyles,
  type SpriteMotionPresetId,
  SpriteMotionPresets,
  spriteMotionPrompt,
} from "@/libs/spriteStudio";
import { showMutationToast } from "@/libs/toast";
import { groupBy } from "@/utils/grouping";
import { formatTimeAgo } from "@/utils/time";
import { UploadButton } from "@/utils/uploadthing";
import type { SpriteSource } from "@/validators/spriteStudio";

/** Create character sprites through gameasset.dev and review them before they reach battles. */
export const SpriteStudio = () => {
  const studio = useSpriteStudio();
  const { account, generations } = studio;
  const balance = account.data?.account;
  return (
    <>
      <ContentBox
        title="Sprite Studio"
        subtitle="Animate any character, ready for battle"
        defaultBackHref="/manual"
        topRightContent={balance && <Balance credits={balance.credits} />}
      >
        {account.isPending && <output>Connecting to gameasset.dev…</output>}
        {account.error && (
          <p role="alert" className="text-destructive text-sm">
            {account.error.message}
          </p>
        )}
        {account.data && !account.data.enabled && (
          <Notice title="gameasset.dev is not connected">
            Set GAMEASSET_API_KEY on this deployment to start creating sprites. The
            animation library keeps working without it.
          </Notice>
        )}
        {account.data?.enabled && !balance && (
          <Notice title="Balance unavailable">
            gameasset.dev did not answer. You can still queue sprites, and any it
            refuses will explain why.
          </Notice>
        )}
        {account.data?.enabled && <Composer studio={studio} />}
      </ContentBox>
      {account.data?.enabled && (
        <ContentBox
          title="Sprite queue"
          subtitle="Review each result before it reaches the library"
          initialBreak
        >
          {generations.isPending && <output>Loading the queue…</output>}
          {generations.error && (
            <p role="alert" className="text-destructive text-sm">
              {generations.error.message}
            </p>
          )}
          {generations.data?.length === 0 && (
            <p className="py-6 text-center text-muted-foreground text-sm">
              Sprites you create appear here. They take two to five minutes.
            </p>
          )}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {generations.data?.map((generation) => (
              <GenerationCard
                key={generation.id}
                generation={generation}
                studio={studio}
              />
            ))}
          </ul>
        </ContentBox>
      )}
    </>
  );
};

/** Three steps on one page: choose the art, describe the motion, name the sheet. */
const Composer = ({ studio }: { studio: Studio }) => {
  const params = useSearchParams();
  const [tab, setTab] = useState<SourceTab>("ai");
  const [aiId, setAiId] = useState(params.get("ai") ?? "");
  const [actionKey, setActionKey] = useState(params.get("action") ?? "idle");
  const [art, setArt] = useState<DrawnArt>();
  const [facing, setFacing] = useState<AvatarFacing>("left");
  const [presetChoice, setPresetChoice] = useState<SpriteMotionPresetId>();
  const [body, setBody] = useState<SpriteBodyPlan>("biped");
  // Undefined follows the preset; a value keeps what the editor typed.
  const [promptEdit, setPromptEdit] = useState<string>();
  const [nameEdit, setNameEdit] = useState<string>();

  const ai = api.spriteStudio.getAiSource.useQuery(
    { userId: aiId },
    { enabled: tab === "ai" && !!aiId },
  );
  const presetId = presetChoice ?? (tab === "ai" ? presetForAction(actionKey) : "idle");
  const preset =
    SpriteMotionPresets.find((entry) => entry.id === presetId) ??
    SpriteMotionPresets[0];
  const prompt = promptEdit ?? spriteMotionPrompt(preset, body);
  const action = ai.data?.actions.find((entry) => entry.key === actionKey);
  const subject = tab === "ai" ? ai.data?.username : art?.label;
  const suggestedName = subject
    ? `${subject} — ${tab === "ai" ? (action?.name ?? preset.label) : preset.label}`
    : "";
  const name = nameEdit ?? suggestedName;

  const source: SpriteSource | undefined =
    tab === "ai"
      ? ai.data && { kind: "ai", userId: ai.data.userId, actionKey }
      : art &&
        (tab === "upload"
          ? { kind: "upload", url: art.url, facing }
          : { kind: "candidate", imageId: art.imageId, url: art.url, facing });
  const artUrl = tab === "ai" ? ai.data?.avatar : art?.url;
  const canGenerate =
    !!source &&
    !!artUrl &&
    !!name.trim() &&
    prompt.trim().length >= 3 &&
    !studio.generate.isPending;

  const chooseTab = (next: SourceTab) => {
    setTab(next);
    setArt(undefined);
    setNameEdit(undefined);
  };

  return (
    <div className="space-y-5">
      <Step number={1} title="Character">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_128px]">
          <Tabs value={tab} onValueChange={(next) => chooseTab(next as SourceTab)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ai">Game AI</TabsTrigger>
              <TabsTrigger value="upload">Upload art</TabsTrigger>
              <TabsTrigger value="describe">Describe</TabsTrigger>
            </TabsList>
            <TabsContent value="ai" className="space-y-3 pt-3">
              <AiPicker
                value={aiId}
                onChange={(id) => {
                  setAiId(id);
                  setActionKey("idle");
                  setNameEdit(undefined);
                }}
              />
              {ai.error && (
                <p role="alert" className="text-destructive text-sm">
                  {ai.error.message}
                </p>
              )}
              {ai.data && !ai.data.avatar && (
                <p role="alert" className="text-destructive text-sm">
                  This AI has no art yet.
                </p>
              )}
              {ai.data && (
                <div>
                  <Label htmlFor="sprite-studio-action">Action</Label>
                  <Select
                    value={actionKey}
                    onValueChange={(next) => {
                      setActionKey(next);
                      setPresetChoice(undefined);
                      setPromptEdit(undefined);
                      setNameEdit(undefined);
                    }}
                  >
                    <SelectTrigger id="sprite-studio-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[...groupBy(ai.data.actions, "group")].map(
                        ([group, actions]) => (
                          <SelectGroup key={group}>
                            <SelectLabel>{group}</SelectLabel>
                            {actions.map((entry) => (
                              <SelectItem key={entry.key} value={entry.key}>
                                {entry.name}
                                {ai.data.assignedKeys.includes(entry.key)
                                  ? " (has a sprite)"
                                  : ""}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </TabsContent>
            <TabsContent value="upload" className="space-y-3 pt-3">
              <p className="text-muted-foreground text-sm">
                A character on a transparent background gives the cleanest loop. Other
                art has its background removed for you.
              </p>
              <UploadButton
                endpoint="spriteAnimationUploader"
                onClientUploadComplete={(files) => {
                  const result = files?.[0]?.serverData;
                  if (result?.error)
                    showMutationToast({ success: false, message: result.error });
                  else if (result?.fileUrl)
                    setArt({
                      url: result.fileUrl,
                      imageId: "",
                      label: files?.[0]?.name.replace(/\.[^.]+$/, "") ?? "Character",
                    });
                }}
                onUploadError={(error) =>
                  showMutationToast({ success: false, message: error.message })
                }
              />
              <FacingPicker value={facing} onChange={setFacing} />
            </TabsContent>
            <TabsContent value="describe" className="space-y-3 pt-3">
              <CharacterDrawer selected={art} onSelect={setArt} />
              {art && <FacingPicker value={facing} onChange={setFacing} />}
            </TabsContent>
          </Tabs>
          <div className="w-32 sm:w-auto">
            <p className="mb-1 font-semibold text-sm">Starting art</p>
            <Checker className="aspect-square rounded-md border">
              {artUrl ? (
                // biome-ignore lint/performance/noImgElement: The source art is shown unchanged, as the model receives it.
                <img src={artUrl} alt="" className="size-full object-contain" />
              ) : (
                <p className="flex h-full items-center justify-center p-3 text-center text-muted-foreground text-xs">
                  Choose a character
                </p>
              )}
            </Checker>
          </div>
        </div>
      </Step>

      <Step number={2} title="Motion">
        <div className="space-y-3">
          <fieldset>
            <legend className="sr-only">Motion preset</legend>
            <div className="flex flex-wrap gap-2">
              {SpriteMotionPresets.map((entry) => (
                <Button
                  key={entry.id}
                  type="button"
                  size="sm"
                  variant={entry.id === preset.id ? "default" : "outline"}
                  aria-pressed={entry.id === preset.id}
                  onClick={() => {
                    setPresetChoice(entry.id);
                    setPromptEdit(undefined);
                    setNameEdit(undefined);
                  }}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </fieldset>
          {preset.prompts && (
            <div className="sm:max-w-56">
              <Label htmlFor="sprite-studio-body">Body</Label>
              <Select
                value={body}
                onValueChange={(next) => {
                  setBody(next as SpriteBodyPlan);
                  setPromptEdit(undefined);
                }}
              >
                <SelectTrigger id="sprite-studio-body">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SpriteBodyPlans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="sprite-studio-prompt">Direction</Label>
            <Textarea
              id="sprite-studio-prompt"
              rows={4}
              maxLength={2000}
              value={prompt}
              placeholder="Describe one movement that ends where it started."
              onChange={(event) => setPromptEdit(event.target.value)}
            />
            <p className="mt-1 text-muted-foreground text-xs">
              One movement that returns to the starting pose works best. Name what the
              character holds, and avoid asking for glowing parts or both hands on a
              weapon.
            </p>
          </div>
        </div>
      </Step>

      <Step number={3} title="Create">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="sprite-studio-name">Library name</Label>
            <Input
              id="sprite-studio-name"
              maxLength={191}
              value={name}
              placeholder="Character — Action"
              onChange={(event) => setNameEdit(event.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={!canGenerate}
            onClick={() =>
              source &&
              studio.generate.mutate(
                {
                  source,
                  name,
                  prompt,
                  motion: preset.motion,
                  frames: preset.frames,
                },
                {
                  onSuccess: (result) => {
                    if (result.success) setNameEdit(undefined);
                  },
                },
              )
            }
          >
            {studio.generate.isPending ? (
              <LoaderCircle className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            {studio.generate.isPending ? "Sending…" : "Create sprite"}
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Creates a {preset.frames === 49 ? "24" : "16"}-frame sheet at 12.5 fps.
          Credits are held now and returned if generation fails.
        </p>
        {studio.generate.error && (
          <p role="alert" className="mt-2 text-destructive text-sm">
            {studio.generate.error.message}
          </p>
        )}
      </Step>
    </div>
  );
};

const AiPicker = ({ value, onChange }: AiPickerProps) => {
  const names = api.profile.getAllAiNames.useQuery(undefined);
  return (
    <div>
      <Label htmlFor="sprite-studio-ai">Character</Label>
      <SearchSelect
        id="sprite-studio-ai"
        label="Character"
        searchLabel="Search AIs"
        emptyText="No AI has that name."
        placeholder={names.isPending ? "Loading AIs…" : "Find an AI"}
        value={value}
        options={(names.data ?? []).map((ai) => ({
          value: ai.userId,
          label: `${ai.username} (Lv ${ai.level})`,
        }))}
        onChange={onChange}
      />
    </div>
  );
};

const FacingPicker = ({ value, onChange }: FacingPickerProps) => (
  <div className="sm:max-w-56">
    <Label htmlFor="sprite-studio-facing">The art faces</Label>
    <Select value={value} onValueChange={(next) => onChange(next as AvatarFacing)}>
      <SelectTrigger id="sprite-studio-facing" className="capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AvatarFacings.map((facing) => (
          <SelectItem key={facing} value={facing} className="capitalize">
            {facing}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

/** Draw four candidates; picking one makes it the art the animation starts from. */
const CharacterDrawer = ({ selected, onSelect }: CharacterDrawerProps) => {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<CharacterStyle>(SpriteCharacterStyles[0]);
  const utils = api.useUtils();
  const draw = api.spriteStudio.drawCharacters.useMutation({
    onSuccess: async (result) => {
      if (result.success) await utils.spriteStudio.getAccount.invalidate();
      else showMutationToast(result);
    },
  });
  const images = draw.data?.success ? draw.data.images : [];
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="sprite-studio-describe">Character</Label>
        <Textarea
          id="sprite-studio-describe"
          rows={2}
          maxLength={1000}
          value={prompt}
          placeholder="A masked rogue ninja with a short curved blade"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="sprite-studio-style">Style</Label>
          <Select
            value={style}
            onValueChange={(next) => setStyle(next as CharacterStyle)}
          >
            <SelectTrigger id="sprite-studio-style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SpriteCharacterStyles.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={prompt.trim().length < 3 || draw.isPending}
          onClick={() => {
            onSelect(undefined);
            draw.mutate({ prompt, style });
          }}
        >
          {draw.isPending ? (
            <LoaderCircle className="mr-2 size-4 animate-spin" />
          ) : (
            <Search className="mr-2 size-4" />
          )}
          {draw.isPending ? "Drawing…" : "Draw 4 options"}
        </Button>
      </div>
      {draw.error && (
        <p role="alert" className="text-destructive text-sm">
          {draw.error.message}
        </p>
      )}
      {images.length > 0 && (
        <div
          className="grid grid-cols-4 gap-2"
          role="radiogroup"
          aria-label="Candidates"
        >
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              aria-pressed={selected?.imageId === image.id}
              aria-label={`Option ${index + 1}`}
              onClick={() =>
                onSelect({
                  url: image.url,
                  imageId: image.id,
                  label: prompt.trim().split(/[,.]/)[0]?.slice(0, 60) ?? "Character",
                })
              }
              className="overflow-hidden rounded-md border-2 border-transparent aria-pressed:border-primary"
            >
              {/* biome-ignore lint/performance/noImgElement: Candidates live on gameasset.dev's storage, outside the image optimizer. */}
              <img
                src={image.url}
                alt=""
                className="aspect-square w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** One request in the shared queue, with the review actions its status allows. */
const GenerationCard = ({ generation, studio }: GenerationCardProps) => {
  const [inspecting, setInspecting] = useState(false);
  const { status } = generation;
  const running = isSpriteGenerationActive(status);
  const sheet = sheetOf(generation);
  const busy =
    studio.accept.isPending || studio.discard.isPending || studio.regenerate.isPending;
  const { id } = generation;
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-md border bg-card">
      <Checker className="relative aspect-square">
        {sheet ? (
          <SpriteAnimationPreview
            key={sheet.id}
            animation={sheet}
            className="rounded-none border-0 bg-transparent"
          />
        ) : (
          // biome-ignore lint/performance/noImgElement: The source art stands in until the sheet exists.
          <img
            src={generation.sourceUrl}
            alt=""
            className={`size-full object-contain ${running ? "opacity-40" : "opacity-60 grayscale"}`}
          />
        )}
        {running && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-card/90 px-3 py-2 text-xs">
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
            <output className="truncate">
              {generation.stage ?? STATUS_LABEL[status]}
            </output>
          </div>
        )}
        <Badge
          variant={status === "FAILED" ? "destructive" : "secondary"}
          className="absolute top-2 left-2"
        >
          {STATUS_LABEL[status]}
        </Badge>
        {sheet && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute top-2 right-2 size-8"
            aria-label={`Inspect ${generation.name}`}
            onClick={() => setInspecting(true)}
          >
            <Maximize2 className="size-4" />
          </Button>
        )}
      </Checker>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-sm" title={generation.name}>
            {generation.name}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {generation.createdBy?.username} ·{" "}
            {formatTimeAgo(new Date(generation.createdAt))}
            {sheet && ` · ${sheet.frameCount} frames`}
          </p>
        </div>
        {generation.error && (
          <p role="alert" className="text-destructive text-xs">
            {generation.error}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          {status === "READY" && (
            <>
              {generation.aiUserId && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => studio.accept.mutate({ id, assign: true })}
                >
                  <Check className="mr-1 size-4" />
                  Assign to AI
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={generation.aiUserId ? "outline" : "default"}
                disabled={busy}
                onClick={() => studio.accept.mutate({ id, assign: false })}
              >
                <Upload className="mr-1 size-4" />
                Add to library
              </Button>
            </>
          )}
          {(status === "READY" || status === "FAILED" || status === "ACCEPTED") && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => studio.regenerate.mutate({ id })}
            >
              <RefreshCw className="mr-1 size-4" />
              New take
            </Button>
          )}
          {status === "ACCEPTED" && generation.aiUserId && (
            <Button asChild type="button" size="sm" variant="outline">
              <Link href={`/manual/ai/edit/${generation.aiUserId}`}>Open AI</Link>
            </Button>
          )}
          {status !== "ACCEPTED" && status !== "PREPARING" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => studio.discard.mutate({ id })}
            >
              <X className="mr-1 size-4" />
              {running ? "Cancel" : "Discard"}
            </Button>
          )}
        </div>
      </div>
      {sheet && (
        <Modal
          title={generation.name}
          isOpen={inspecting}
          setIsOpen={setInspecting}
          isValid={false}
          className="sm:max-w-3xl"
        >
          <SheetInspector artUrl={generation.sourceUrl} sheet={sheet} />
        </Modal>
      )}
    </li>
  );
};

/** Damage hides at thumbnail size, so review shows the loop, the art and every frame. */
const SheetInspector = ({ artUrl, sheet }: SheetInspectorProps) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="mb-1 font-semibold text-sm">Sprite</p>
        <Checker className="rounded-md border">
          <SpriteAnimationPreview
            animation={sheet}
            className="rounded-none border-0 bg-transparent"
          />
        </Checker>
      </div>
      <div>
        <p className="mb-1 font-semibold text-sm">Starting art</p>
        <Checker className="aspect-square rounded-md border">
          {/* biome-ignore lint/performance/noImgElement: Review compares against the unchanged source. */}
          <img src={artUrl} alt="" className="size-full object-contain" />
        </Checker>
      </div>
    </div>
    <div>
      <p className="mb-1 font-semibold text-sm">All frames</p>
      <Checker className="rounded-md border">
        {/* biome-ignore lint/performance/noImgElement: A packed atlas must load unchanged from the CDN. */}
        <img src={sheet.url} alt="Every frame of the sheet" className="w-full" />
      </Checker>
    </div>
    <p className="text-muted-foreground text-xs">
      {sheet.columns} × {sheet.rows} sheet · {sheet.frameCount} frames · {sheet.fps} fps
      · faces {sheet.facing}
    </p>
  </div>
);

const Step = ({ number, title, children }: StepProps) => (
  <section aria-label={title}>
    <h3 className="mb-2 flex items-center gap-2 font-semibold">
      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
        {number}
      </span>
      {title}
    </h3>
    {children}
  </section>
);

/** Transparent sprites and art read best on the usual editor checkerboard. */
const Checker = ({ className, children }: CheckerProps) => (
  <div
    className={className}
    style={{
      background:
        "repeating-conic-gradient(hsl(var(--muted)) 0 25%, hsl(var(--card)) 0 50%) 0 0 / 16px 16px",
    }}
  >
    {children}
  </div>
);

const Balance = ({ credits }: { credits: number }) => (
  <span className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
    <Wallet className="size-4" />
    <span className="sr-only">gameasset.dev balance</span>$
    {credits.toLocaleString("en-US", { minimumFractionDigits: 2 })}
  </span>
);

const Notice = ({ title, children }: NoticeProps) => (
  <div role="alert" className="mb-3 flex gap-2 rounded-md border p-3 text-sm">
    <TriangleAlert className="size-4 shrink-0" />
    <div>
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  </div>
);

/** The finished sheet in the shape the shared preview plays. */
const sheetOf = (generation: Generation) => {
  const { url, columns, rows, frameCount, fps } = generation;
  if (!url || !columns || !rows || !frameCount || !fps) return null;
  return {
    id: generation.id,
    name: generation.name,
    url,
    smallUrl: generation.smallUrl,
    columns,
    rows,
    frameCount,
    fps,
    facing: generation.facing,
  };
};

const STATUS_LABEL: Record<Generation["status"], string> = {
  QUEUED: "Queued",
  PROCESSING: "Animating",
  PREPARING: "Preparing",
  READY: "Ready for review",
  ACCEPTED: "In library",
  DISCARDED: "Discarded",
  FAILED: "Failed",
};

type Studio = ReturnType<typeof useSpriteStudio>;
type Generation = RouterOutputs["spriteStudio"]["getGenerations"][number];
type CharacterStyle = (typeof SpriteCharacterStyles)[number];
type SourceTab = "ai" | "upload" | "describe";
type DrawnArt = { url: string; imageId: string; label: string };
type AiPickerProps = { value: string; onChange: (id: string) => void };
type FacingPickerProps = {
  value: AvatarFacing;
  onChange: (facing: AvatarFacing) => void;
};
type CharacterDrawerProps = {
  selected: DrawnArt | undefined;
  onSelect: (art: DrawnArt | undefined) => void;
};
type GenerationCardProps = { generation: Generation; studio: Studio };
type SheetInspectorProps = {
  artUrl: string;
  sheet: NonNullable<ReturnType<typeof sheetOf>>;
};
type StepProps = { number: number; title: string; children: React.ReactNode };
type CheckerProps = { className?: string; children: React.ReactNode };
type NoticeProps = { title: string; children: React.ReactNode };
