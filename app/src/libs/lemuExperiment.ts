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

/** Enroll visitors only when every alternative has a configured portrait. */
const LEMU_ALTERNATIVES = IMG_URL_ASSISTANT_ALTERNATIVES;

/** Fraction of each intro image above its waist, used to crop against the dialogue border. */
export const LEMU_PORTRAIT_WAIST: Record<string, number> = {
  [IMG_URL_ASSISTANT]: 0.7,
  [LEMU_ALTERNATIVES[0]]: 0.44,
  [LEMU_ALTERNATIVES[1]]: 0.46,
  [LEMU_ALTERNATIVES[2]]: 0.44,
  [LEMU_ALTERNATIVES[3]]: 0.43,
  [LEMU_ALTERNATIVES[4]]: 0.42,
  [LEMU_ALTERNATIVES[5]]: 0.41,
};

export const isLemuExperimentEnabled =
  LEMU_ALTERNATIVES.length === LEMU_VARIANTS.length - 1;

export const normalizeLemuVariant = (value?: string | null): LemuVariant | undefined =>
  isLemuExperimentEnabled
    ? LEMU_VARIANTS.find((variant) => variant === value)
    : undefined;

export const drawLemuVariant = (): LemuVariant =>
  LEMU_VARIANTS[Math.floor(Math.random() * LEMU_VARIANTS.length)] ?? "control";

export const getLemuImage = (variant?: string) => {
  const assignment = normalizeLemuVariant(variant);
  const index = LEMU_VARIANTS.indexOf(assignment ?? "control");
  return (index > 0 ? LEMU_ALTERNATIVES[index - 1] : undefined) ?? IMG_URL_ASSISTANT;
};

const LEMU_LABELS = [
  "Current Lemu",
  "Silver blade",
  "Golden hawk",
  "Shadow mentor",
  "Copper lioness",
  "Tiger captain",
  "Moon sentinel",
] as const;

export const lemuLabel = (variant: string) => {
  const assignment = normalizeLemuVariant(variant);
  return assignment
    ? (LEMU_LABELS[LEMU_VARIANTS.indexOf(assignment)] ?? variant)
    : variant;
};
