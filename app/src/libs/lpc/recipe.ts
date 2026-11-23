import { z } from "zod";
import type { LpcBody, LpcMaterial } from "@/validators/lpc";
import { lpcAnimations, lpcMaterials } from "@/validators/lpc";
import { type LpcConfig, lpcConfigValidator } from "@/validators/lpcAsset";

const selectionSchema = z.object({
  itemId: z.string().max(191),
  name: z.string().max(512).optional(),
  subId: z.number().int().min(0).max(7).nullish(),
  variant: z.string().max(191).nullish(),
  recolor: z.string().max(191).nullish(),
});
const recipeSchema = z
  .object({
    version: z.literal(2),
    bodyType: z.enum(["male", "female"]),
    selections: z.record(z.string().max(191), selectionSchema),
    selectedAnimation: z.string().max(64).optional(),
    enabledAnimations: z.record(z.string().max(64), z.boolean()).optional(),
  })
  .refine(
    (recipe) => Object.keys(recipe.selections).length <= 128,
    "A recipe supports at most 128 selections.",
  );

/** Convert a generator URL or v2 recipe using only published library designs; never fetch arbitrary URLs. */
export const importLpcRecipe = (
  text: string,
  designs: { id: string; hidden: boolean; lpcConfig: LpcConfig | null }[],
  settings: Pick<LpcConfig, "category">,
) => {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
    throw new Error("Generator recipes must be at most 2 MB.");
  const library = designs.filter(
    (design): design is typeof design & { lpcConfig: LpcConfig } =>
      !design.hidden && !!design.lpcConfig,
  );
  const warnings: string[] = [];
  const selections: {
    design: (typeof library)[number];
    colors: Map<string, string>;
    color?: string;
    eyes?: string;
  }[] = [];
  let body: LpcBody;
  const add = (id: string, value: string | null | undefined, subId?: number | null) => {
    const matches = library.filter((candidate) =>
      candidate.lpcConfig.upstream?.some((source) => source.id === id),
    );
    const design = matches.length === 1 ? matches[0] : undefined;
    if (matches.length > 1) {
      warnings.push(
        `Ambiguous artwork: ${id}. Keep one library design linked to this generator definition.`,
      );
      return;
    }
    if (!design) {
      warnings.push(`Unsupported artwork: ${id}.`);
      return;
    }
    const source = design.lpcConfig.upstream.find((entry) => entry.id === id)!;
    let chosen = selections.find((entry) => entry.design.id === design.id);
    if (!chosen) {
      chosen = { design, colors: new Map() };
      selections.push(chosen);
    }
    if (!value) return;
    const raw = value.split(".").at(-1)!.toLowerCase().replaceAll(" ", "_");
    const color =
      (
        { blonde: "yellow", grey: "gray", white_skin: "ivory" } as Record<
          string,
          string
        >
      )[raw] ?? raw;
    const material = source.colors[subId ?? 0]?.material;
    if (material === "eyes") chosen.eyes = color;
    else if (material && lpcMaterials.includes(material as LpcMaterial))
      chosen.colors.set(material, color);
    else chosen.color = color;
  };
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const parsed = recipeSchema.safeParse(JSON.parse(trimmed));
    if (!parsed.success)
      throw new Error("Use a generator v2 JSON recipe with a male or female body.");
    body = parsed.data.bodyType;
    const unused = new Set(
      [
        parsed.data.selectedAnimation,
        ...Object.entries(parsed.data.enabledAnimations ?? {})
          .filter(([, enabled]) => enabled)
          .map(([animation]) => animation),
      ].filter(
        (animation): animation is string =>
          !!animation && !(lpcAnimations as readonly string[]).includes(animation),
      ),
    );
    if (unused.size)
      warnings.push(`Animations not used by the game: ${[...unused].join(", ")}.`);
    for (const selected of Object.values(parsed.data.selections))
      add(selected.itemId, selected.recolor || selected.variant, selected.subId);
  } else {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "liberatedpixelcup.github.io" ||
      url.pathname !== "/Universal-LPC-Spritesheet-Character-Generator/"
    )
      throw new Error(
        "Paste a Universal LPC generator URL or its exported JSON recipe.",
      );
    const params = new URLSearchParams(url.hash.slice(1));
    const selectedBody = params.get("sex");
    if (selectedBody !== "male" && selectedBody !== "female")
      throw new Error(
        "Choose a male or female body in the generator. Other body types are not supported.",
      );
    body = selectedBody;
    const candidates = library
      .flatMap((design) =>
        (design.lpcConfig.upstream ?? []).flatMap((source) => [
          {
            source,
            group: source.group,
            label: source.name.replaceAll(" ", "_"),
            subId: undefined as number | undefined,
          },
          ...source.colors.map((color, index) => ({
            source,
            group: color.group,
            label: color.label.replaceAll(" ", "_"),
            subId: index,
          })),
        ]),
      )
      .sort((a, b) => b.label.length - a.label.length);
    for (const [group, value] of params) {
      if (group === "sex") continue;
      const matches = candidates.filter(
        (entry) =>
          entry.group === group &&
          (value === entry.label || value.startsWith(`${entry.label}_`)),
      );
      const longest = matches[0]?.label.length;
      const exact = matches.filter((entry) => entry.label.length === longest);
      if (new Set(exact.map((entry) => entry.source.id)).size > 1) {
        warnings.push(
          `Ambiguous selection: ${group} (${value}). Export JSON to identify its exact artwork.`,
        );
        continue;
      }
      const candidate = exact[0];
      if (!candidate) {
        warnings.push(`Unsupported selection: ${group} (${value}).`);
        continue;
      }
      add(
        candidate.source.id,
        value
          .slice(candidate.label.length + 1)
          .split("|")
          .at(-1),
        candidate.subId,
      );
    }
  }
  if (!selections.length)
    throw new Error("No selected artwork is available in the game library.");
  const variants: LpcConfig["variants"] = {};
  const replacementSlots = new Set<LpcConfig["replacementSlots"][number]>();
  for (const style of ["male", "female"] as const) {
    const sheets: LpcConfig["variants"][string] = [];
    for (const [selectionIndex, entry] of selections.entries()) {
      const config = entry.design.lpcConfig;
      for (const slot of config.replacementSlots) replacementSlots.add(slot);
      if (["body", "head", "hair", "beard"].includes(config.category))
        replacementSlots.add(config.category as "body" | "head" | "hair" | "beard");
      const eyes = entry.eyes ?? config.defaultEyes,
        color = entry.color ?? config.defaultColor;
      const exact = config.variants[`${style}/${color}/${eyes}`];
      const base =
        exact ??
        config.variants[`${style}/${config.defaultColor}/${config.defaultEyes}`];
      if (!exact && (entry.color || entry.eyes))
        warnings.push(
          `${entry.design.id}: ${color}/${eyes} is unavailable on ${style}; using its default.`,
        );
      if (!base)
        throw new Error(`${entry.design.id} has no default artwork for ${style}.`);
      for (const [material, selectedColor] of entry.colors)
        if (!base.some((sheet) => sheet.material === material))
          warnings.push(
            `${entry.design.id}: ${material} colour ${selectedColor} is unavailable on ${style}; using the saved palette.`,
          );
      const components = [...new Set(base.map((sheet) => sheet.component))];
      for (const [index, sheet] of base.entries()) {
        const selectedColor = sheet.material && entry.colors.get(sheet.material);
        const selected =
          selectedColor &&
          config.variants[`${style}/${selectedColor}/${eyes}`]?.find(
            (part) => part.part === sheet.part && part.material === sheet.material,
          );
        if (selectedColor && !selected)
          warnings.push(
            `${entry.design.id}: ${sheet.material} colour ${selectedColor} is unavailable on ${style}; using the saved palette.`,
          );
        sheets.push({
          ...(selected || sheet),
          part: `recipe_${selectionIndex}_${index}`,
          component: `recipe_${selectionIndex}_${components.indexOf(sheet.component)}`,
        });
      }
    }
    if (sheets.length > 16)
      throw new Error(
        "This selection has more than 16 sheet layers. Import a smaller equipment selection.",
      );
    variants[`${style}/gray/blue`] = sheets;
  }
  const attributions = [
    ...new Map(
      selections
        .flatMap((entry) => entry.design.lpcConfig.attributions)
        .map((credit) => [JSON.stringify(credit), credit]),
    ).values(),
  ];
  const config = lpcConfigValidator.parse({
    version: 2,
    category: settings.category,
    replacementSlots: [...replacementSlots],
    defaultColor: "gray",
    defaultEyes: "blue",
    variants,
    attributions,
    sourceUrl:
      "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/",
    upstream: [],
  });
  return {
    config,
    body,
    warnings: [...new Set(warnings)],
    designs: selections.map((entry) => entry.design.id),
  };
};
