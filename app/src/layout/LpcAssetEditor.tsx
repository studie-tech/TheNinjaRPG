"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type UseFormReturn, useFormState, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { CharacterPreview } from "@/layout/CharacterPreview";
import { previewSpriteDesign, resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import { chunkArray } from "@/utils/array";
import { textureImageUrl } from "@/utils/image";
import { UploadButton } from "@/utils/uploadthing";
import type { ZodGameAssetInput, ZodGameAssetType } from "@/validators/asset";
import type { LpcAnimation, LpcBody } from "@/validators/lpc";
import { lpcAnimations, lpcColors } from "@/validators/lpc";
import {
  LPC_CONFIG_MAX_BYTES,
  type LpcConfig,
  lpcCategories,
  lpcConfigValidator,
  lpcLayoutValidator,
  lpcReplacementSlots,
} from "@/validators/lpcAsset";

/** Edit one design's variants and layers while previewing unsaved artwork with the game renderer. */
export function LpcAssetEditor({
  id,
  name,
  form,
  disabled,
  onBusyChange,
}: {
  id: string;
  name: string;
  form: UseFormReturn<ZodGameAssetInput, unknown, ZodGameAssetType>;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const value = useWatch({ control: form.control, name: "lpcConfig" });
  const config = value ?? emptyConfig;
  const { errors, submitCount } = useFormState({
    control: form.control,
    name: "lpcConfig",
  });
  const configErrors = errors.lpcConfig;
  const attributionDetails = useRef<HTMLDetailsElement>(null);
  const previousSubmitCount = useRef(0);
  const hasAttributionErrors = !!(
    configErrors?.attributions ||
    configErrors?.sourceRevision ||
    configErrors?.sourceUrl
  );
  // Failed saves reveal the relevant fields; ordinary correction must retain the caret.
  useEffect(() => {
    if (submitCount === previousSubmitCount.current) return;
    previousSubmitCount.current = submitCount;
    if (submitCount && hasAttributionErrors && attributionDetails.current) {
      attributionDetails.current.open = true;
      attributionDetails.current
        .querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [submitCount, hasAttributionErrors]);
  const {
    data: designs,
    error: catalogError,
    refetch: retryCatalog,
  } = api.gameAsset.getLpcCatalog.useQuery();
  const [body, setBody] = useState<LpcBody>("male");
  const [color, setColor] = useState(config.defaultColor);
  const [eyes, setEyes] = useState(config.defaultEyes);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [format, setFormat] = useState<"packed" | "standard">("standard");
  const [animation, setAnimation] = useState<LpcAnimation>("walk");
  const [playing, setPlaying] = useState(true);
  const [solo, setSolo] = useState(false);
  const [layoutText, setLayoutText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Preparation must update the variant/layer selected when the upload began.
  const activeUpload = useRef<{
    config: LpcConfig;
    key: string;
    index: number;
    format: "packed" | "standard";
    layout: string;
    z: number;
  } | null>(null);
  const { mutateAsync: prepareSheet } = api.gameAsset.prepareLpcSheet.useMutation();
  const key = `${body}/${color}/${eyes}`;
  const sheets = config.variants[key] ?? [];
  const sheet = sheets[sheetIndex];
  const layoutSignature = JSON.stringify(sheet?.layout ?? null);
  useEffect(() => {
    setLayoutText(sheet ? JSON.stringify(sheet.layout, null, 2) : "");
  }, [layoutSignature, key, sheetIndex, sheet?.image]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = (next: LpcConfig) =>
    form.setValue("lpcConfig", next, { shouldDirty: true, shouldValidate: true });
  const working = (next: boolean) => {
    setBusy(next);
    onBusyChange(next);
  };
  const fail = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : "Could not process this file.");
  /** Prepare the captured draft layer and ignore results after its editor unmounts. */
  const finishUpload = async (url: string) => {
    const operation = activeUpload.current;
    if (!operation || !mounted.current) return;
    try {
      const layout =
        operation.format === "packed"
          ? lpcLayoutValidator.parse(JSON.parse(operation.layout))
          : undefined;
      const result = await prepareSheet({
        image: url,
        format: operation.format,
        layout,
        z: operation.z,
      });
      if (!mounted.current) return;
      if (!result.success || !result.sheet) throw new Error(result.message);
      const variants = { ...operation.config.variants },
        next = [...(variants[operation.key] ?? [])];
      next[operation.index] = result.sheet;
      variants[operation.key] = next;
      change({ ...operation.config, variants });
    } catch (cause) {
      if (mounted.current) fail(cause);
    } finally {
      if (mounted.current) working(false);
      activeUpload.current = null;
    }
  };
  // Drafts may have only one body while the artist works; persistence requires both.
  const catalog = useMemo(
    () =>
      buildLpcCatalog([
        ...(designs ?? []).filter((asset) => asset.id !== id),
        { id, lpcConfig: config },
      ]),
    [designs, id, config],
  );
  const preview = resolveSpriteAppearance({ spriteBodyStyle: body });
  const appearance = previewSpriteDesign(preview, id, config, color, eyes, solo);

  return (
    <section
      className="border-border bg-background/70 @container space-y-5 rounded-xl border p-4 sm:p-5"
      aria-labelledby="lpc-design-heading"
    >
      <div>
        <h3 id="lpc-design-heading" className="text-lg font-semibold">
          LPC design
        </h3>
        <p className="text-muted-foreground text-sm">
          Manage body and colour variants together. Both body styles need the default
          variant before saving. Saved changes appear on the next scene load.
        </p>
      </div>
      <fieldset disabled={disabled || busy} className="space-y-4">
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Design settings
          </summary>
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
            <LpcSelect
              label="Design category"
              value={config.category}
              values={lpcCategories}
              onChange={(category) =>
                change({ ...config, category: category as LpcConfig["category"] })
              }
            />
            <LpcSelect
              label="Replaces base clothing"
              value={config.replacementSlot}
              values={lpcReplacementSlots}
              onChange={(replacementSlot) =>
                change({
                  ...config,
                  replacementSlot: replacementSlot as LpcConfig["replacementSlot"],
                })
              }
            />
            <LpcSelect
              label="Default colour"
              value={config.defaultColor}
              values={[
                ...new Set([
                  ...lpcColors,
                  "light",
                  "olive",
                  "ivory",
                  config.defaultColor,
                ]),
              ]}
              onChange={(defaultColor) => change({ ...config, defaultColor })}
            />
            <LpcSelect
              label="Default eyes"
              value={config.defaultEyes}
              values={[
                "blue",
                "black",
                "brown",
                "gray",
                "green",
                "red",
                "yellow",
                "white",
              ]}
              onChange={(defaultEyes) => change({ ...config, defaultEyes })}
            />
          </div>
        </details>
        <div className="border-border grid grid-cols-1 gap-3 rounded-lg border p-3 @[320px]:grid-cols-3">
          <LpcSelect
            label="Body style"
            value={body}
            values={[
              { id: "male", name: "Broad" },
              { id: "female", name: "Slender" },
            ]}
            onChange={(next) => {
              setBody(next as LpcBody);
              setSheetIndex(0);
            }}
          />
          <LpcSelect
            label="Variant colour"
            value={color}
            values={[
              ...new Set([
                ...lpcColors,
                "light",
                "olive",
                "ivory",
                ...Object.keys(config.variants).map(
                  (variant) => variant.split("/")[1]!,
                ),
              ]),
            ]}
            onChange={(next) => {
              setColor(next);
              setSheetIndex(0);
            }}
          />
          <LpcSelect
            label="Variant eyes"
            value={eyes}
            values={[
              "blue",
              "black",
              "brown",
              "gray",
              "green",
              "red",
              "yellow",
              "white",
            ]}
            onChange={(next) => {
              setEyes(next);
              setSheetIndex(0);
            }}
          />
          <div className="col-span-full text-sm">
            {sheets.length
              ? `${sheets.length} sheet layers in this variant`
              : "This variant has no artwork yet."}
          </div>
        </div>
        <div className="grid items-start gap-5 @[600px]:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-3 @[600px]:col-start-2 @[600px]:row-start-1">
            {sheets.length > 0 && (solo || designs) ? (
              <CharacterPreview
                user={{}}
                catalog={catalog}
                appearance={appearance}
                animation={playing ? animation : "stand"}
                label={solo ? "Sheet layers" : "Outfit preview"}
              />
            ) : (
              <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
                Upload artwork for this variant to preview it.
              </p>
            )}
            <LpcSelect
              label="Preview animation"
              value={animation}
              values={lpcAnimations}
              onChange={(next) => setAnimation(next as LpcAnimation)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause preview" : "Play preview"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setSolo(!solo)}
            >
              {solo ? "Show on character" : "Show design alone"}
            </Button>
            <div className="space-y-1 text-sm" role="status">
              {(["male", "female"] as const).map((style) => (
                <p key={style}>
                  {style === "male" ? "Broad" : "Slender"}:{" "}
                  {config.variants[
                    `${style}/${config.defaultColor}/${config.defaultEyes}`
                  ]
                    ? "default variant provided"
                    : "default variant required"}
                </p>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-4 @[600px]:col-start-1 @[600px]:row-start-1">
            <LpcSelect
              label="Sheet layer"
              value={String(sheetIndex)}
              values={[
                ...sheets.map((part, index) => ({
                  id: String(index),
                  name: `Layer ${index + 1} (draw order ${part.z})`,
                })),
                { id: String(sheets.length), name: "Add a layer" },
              ]}
              onChange={(next) => setSheetIndex(Number(next))}
            />
            {sheet && (
              <div className="flex flex-wrap items-end gap-3">
                <Label className="grid gap-2">
                  Draw order
                  <NumberInput
                    value={sheet.z}
                    min={-1000}
                    max={1000}
                    onValueChange={(z) => {
                      const next = [...sheets];
                      next[sheetIndex] = {
                        ...sheet,
                        z,
                        ...(sheet.travel ? { travel: { ...sheet.travel, z } } : {}),
                      };
                      change({
                        ...config,
                        variants: { ...config.variants, [key]: next },
                      });
                    }}
                  />
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const next = sheets.filter((_, index) => index !== sheetIndex),
                      variants = { ...config.variants };
                    if (next.length) variants[key] = next;
                    else delete variants[key];
                    change({ ...config, variants });
                    setSheetIndex(0);
                  }}
                >
                  Remove layer
                </Button>
              </div>
            )}
            <LpcSelect
              label="Upload format"
              value={format}
              values={[
                { id: "standard", name: "Standard LPC export (832px wide PNG)" },
                { id: "packed", name: "Packed game atlas + frame layout" },
              ]}
              onChange={(next) => setFormat(next as "packed" | "standard")}
            />
            {format === "packed" && (
              <Label className="grid gap-2">
                Frame layout (JSON)
                <Textarea
                  value={layoutText}
                  onChange={(event) => setLayoutText(event.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                />
                <span className="text-muted-foreground text-xs">
                  Use the layout from the exported design. Replacing a sheet regenerates
                  its travel atlas.
                </span>
              </Label>
            )}
            {format === "packed" && sheet && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(null);
                  activeUpload.current = {
                    config,
                    key,
                    index: sheetIndex,
                    format: "packed",
                    layout: layoutText,
                    z: sheet.z,
                  };
                  working(true);
                  void finishUpload(sheet.image);
                }}
              >
                Apply frame layout
              </Button>
            )}
            <UploadButton
              endpoint="lpcSheetUploader"
              disabled={disabled || busy}
              onUploadBegin={() => {
                setError(null);
                activeUpload.current = {
                  config,
                  key,
                  index: sheetIndex,
                  format,
                  layout: layoutText,
                  z: sheet?.z ?? 140,
                };
                working(true);
              }}
              onClientUploadComplete={(files) => {
                const url = files[0]?.serverData?.fileUrl;
                if (url) void finishUpload(url);
                else {
                  setError("The upload did not return a file. Try again.");
                  working(false);
                }
              }}
              onUploadError={(cause) => {
                fail(cause);
                activeUpload.current = null;
                working(false);
              }}
            />
            <details ref={attributionDetails}>
              <summary className="cursor-pointer text-sm font-medium">
                Attribution and source details
              </summary>
              <div className="mt-3 space-y-3">
                {config.attributions.map((credit, index) => {
                  const creditErrors = configErrors?.attributions?.[index];
                  const edit = (patch: Partial<typeof credit>) =>
                    change({
                      ...config,
                      attributions: config.attributions.map((entry, i) =>
                        i === index ? { ...entry, ...patch } : entry,
                      ),
                    });
                  return (
                    <div
                      key={index}
                      className="border-border space-y-3 rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium">Credit {index + 1}</p>
                      <Label className="grid gap-2">
                        Artists (required, one per line)
                        <Textarea
                          rows={2}
                          aria-invalid={!!creditErrors?.authors}
                          value={credit.authors.join("\n")}
                          onChange={(event) =>
                            edit({ authors: event.target.value.split("\n") })
                          }
                        />
                      </Label>
                      {creditErrors?.authors && (
                        <p role="alert" className="text-destructive text-sm">
                          Enter at least one artist, one per line (up to 191 characters
                          each).
                        </p>
                      )}
                      <Label className="grid gap-2">
                        Licence (required)
                        <Input
                          aria-invalid={!!creditErrors?.chosenLicense}
                          value={credit.chosenLicense}
                          onChange={(event) =>
                            edit({
                              chosenLicense: event.target.value,
                              licenses: [event.target.value],
                            })
                          }
                        />
                      </Label>
                      {creditErrors?.chosenLicense && (
                        <p role="alert" className="text-destructive text-sm">
                          {creditErrors.chosenLicense.message}
                        </p>
                      )}
                      <Label className="grid gap-2">
                        Source URLs (one per line)
                        <Textarea
                          rows={2}
                          aria-invalid={!!creditErrors?.urls}
                          value={credit.urls.join("\n")}
                          onChange={(event) =>
                            edit({
                              urls: event.target.value
                                ? event.target.value.split("\n")
                                : [],
                            })
                          }
                        />
                      </Label>
                      {creditErrors?.urls && (
                        <p role="alert" className="text-destructive text-sm">
                          Enter valid source URLs, one per line (up to 50 URLs).
                        </p>
                      )}
                      <Label className="grid gap-2">
                        Attribution notes
                        <Textarea
                          rows={2}
                          aria-invalid={!!creditErrors?.notes}
                          value={credit.notes}
                          onChange={(event) => edit({ notes: event.target.value })}
                        />
                      </Label>
                      {creditErrors?.notes && (
                        <p role="alert" className="text-destructive text-sm">
                          {creditErrors.notes.message}
                        </p>
                      )}
                      {config.attributions.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            change({
                              ...config,
                              attributions: config.attributions.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          Remove credit
                        </Button>
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    change({
                      ...config,
                      attributions: [
                        ...config.attributions,
                        {
                          authors: [],
                          licenses: ["TNR"],
                          chosenLicense: "TNR",
                          urls: [],
                          notes: "",
                        },
                      ],
                    })
                  }
                >
                  Add credit
                </Button>
                <Label className="grid gap-2">
                  Source revision
                  <Input
                    aria-invalid={!!configErrors?.sourceRevision}
                    value={config.sourceRevision ?? ""}
                    onChange={(event) =>
                      change({
                        ...config,
                        sourceRevision: event.target.value || undefined,
                      })
                    }
                  />
                </Label>
                {configErrors?.sourceRevision && (
                  <p role="alert" className="text-destructive text-sm">
                    {configErrors.sourceRevision.message}
                  </p>
                )}
                <Label className="grid gap-2">
                  Source collection URL
                  <Input
                    aria-invalid={!!configErrors?.sourceUrl}
                    value={config.sourceUrl ?? ""}
                    onChange={(event) =>
                      change({ ...config, sourceUrl: event.target.value || undefined })
                    }
                  />
                </Label>
                {configErrors?.sourceUrl && (
                  <p role="alert" className="text-destructive text-sm">
                    {configErrors.sourceUrl.message}
                  </p>
                )}
              </div>
            </details>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  setError(null);
                  working(true);
                  try {
                    await downloadLpcDesign(name, config);
                  } catch (cause) {
                    fail(cause);
                  } finally {
                    if (mounted.current) working(false);
                  }
                }}
              >
                Download design and sheets
              </Button>
              <Label className="focus-within:ring-ring cursor-pointer rounded-md border px-3 py-2 text-sm focus-within:ring-1">
                Import design settings
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  disabled={disabled || busy}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > LPC_CONFIG_MAX_BYTES)
                        throw new Error("Design settings must be at most 2 MB.");
                      const parsed = lpcConfigValidator.parse(
                        JSON.parse(await file.text()),
                      );
                      change(parsed);
                      setColor(parsed.defaultColor);
                      setEyes(parsed.defaultEyes);
                      setSheetIndex(0);
                      setError(null);
                    } catch (cause) {
                      fail(cause);
                    }
                    event.target.value = "";
                  }}
                />
              </Label>
            </div>
          </div>
        </div>
      </fieldset>
      {busy && (
        <p role="status" className="text-sm">
          Preparing artwork…
        </p>
      )}
      {catalogError && (
        <p role="alert" className="text-destructive text-sm">
          Could not load the outfit preview.{" "}
          <Button type="button" variant="outline" onClick={() => void retryCatalog()}>
            Try again
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive break-words text-sm">
          {error}
        </p>
      )}
      {configErrors && (
        <p role="alert" className="text-destructive text-sm">
          Provide valid settings, attribution and default variants for both body styles
          before saving.
        </p>
      )}
    </section>
  );
}

/** Keep design and variant choices labelled and compact within the editor's available width. */
function LpcSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly (string | { id: string; name: string })[];
  onChange: (value: string) => void;
}) {
  return (
    <Label className="grid min-w-0 gap-2">
      {label}
      <select
        className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {values.map((entry) => {
          const option = typeof entry === "string" ? { id: entry, name: entry } : entry;
          return (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          );
        })}
      </select>
    </Label>
  );
}

/** Export immutable image bytes alongside round-trippable settings and a file-to-URL index. */
async function downloadLpcDesign(name: string, config: LpcConfig) {
  // Archive support is needed only on export, so it stays out of the initial editor bundle.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip(),
    urls = [
      ...new Set(
        Object.values(config.variants)
          .flat()
          .flatMap((sheet) => [
            sheet.image,
            ...(sheet.travel ? [sheet.travel.image] : []),
          ]),
      ),
    ];
  const files: Record<string, string> = {};
  for (const batch of chunkArray(urls, 5))
    await Promise.all(
      batch.map(async (url) => {
        const response = await fetch(textureImageUrl(url, 0));
        if (!response.ok) throw new Error("Could not download a sheet. Try again.");
        const file = `sheets/${urls.indexOf(url)}.${response.headers.get("content-type")?.includes("webp") ? "webp" : "png"}`;
        zip.file(file, await response.arrayBuffer());
        files[file] = url;
      }),
    );
  zip.file("design.json", JSON.stringify(config));
  zip.file("files.json", JSON.stringify(files, null, 2));
  const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" })),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "-") || "lpc-design"}.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const emptyConfig: LpcConfig = {
  version: 1,
  category: "equipment",
  replacementSlot: "none",
  defaultColor: "gray",
  defaultEyes: "blue",
  variants: {},
  attributions: [
    { authors: [], licenses: ["TNR"], chosenLicense: "TNR", urls: [], notes: "" },
  ],
};
