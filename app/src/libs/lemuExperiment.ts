import { IMG_URL_ASSISTANT, IMG_URL_ASSISTANT_ALTERNATIVES } from "@/drizzle/constants";

export const LEMU_EXPERIMENT = "ab_lemu_replacement_3";
export const LEMU_VARIANTS = [
  "control",
  "treatment_1",
  "treatment_2",
  "treatment_3",
  "treatment_4",
  "treatment_5",
  "treatment_6",
] as const;
export type LemuVariant = (typeof LEMU_VARIANTS)[number];

/** Fraction of each intro image above its waist, used to crop against the dialogue border. */
export const LEMU_PORTRAIT_WAIST: Record<string, number> = {
  [IMG_URL_ASSISTANT]: 0.7,
  [IMG_URL_ASSISTANT_ALTERNATIVES[0].url]: 0.44,
  [IMG_URL_ASSISTANT_ALTERNATIVES[1].url]: 0.46,
  [IMG_URL_ASSISTANT_ALTERNATIVES[2].url]: 0.44,
  [IMG_URL_ASSISTANT_ALTERNATIVES[3].url]: 0.43,
  [IMG_URL_ASSISTANT_ALTERNATIVES[4].url]: 0.42,
  [IMG_URL_ASSISTANT_ALTERNATIVES[5].url]: 0.41,
};

export const normalizeLemuVariant = (value?: string | null): LemuVariant | undefined =>
  LEMU_VARIANTS.find((variant) => variant === value);

export const drawLemuVariant = (): LemuVariant =>
  LEMU_VARIANTS[Math.floor(Math.random() * LEMU_VARIANTS.length)] ?? "control";

export const getLemuImage = (variant?: string) => {
  const assignment = normalizeLemuVariant(variant);
  const index = LEMU_VARIANTS.indexOf(assignment ?? "control");
  return getLemuAlternative(index)?.url ?? IMG_URL_ASSISTANT;
};

export const lemuLabel = (variant: string) => {
  const assignment = normalizeLemuVariant(variant);
  if (!assignment) return variant;
  const index = LEMU_VARIANTS.indexOf(assignment);
  return index === 0 ? "Current Lemu" : (getLemuAlternative(index)?.label ?? variant);
};

/** Treatment arms map onto the portrait alternatives in order; control has none. */
const getLemuAlternative = (variantIndex: number) =>
  variantIndex > 0 ? IMG_URL_ASSISTANT_ALTERNATIVES[variantIndex - 1] : undefined;
