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
