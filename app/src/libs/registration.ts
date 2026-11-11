import type { RegistrationSchema } from "@/validators/register";

type RegistrationField = keyof RegistrationSchema;

/** Zero-based registration carousel step on which each form field is shown */
export const REGISTRATION_FIELD_STEPS: Record<RegistrationField, number> = {
  username: 0,
  gender: 0,
  spriteBodyStyle: 1,
  hair_color: 1,
  eye_color: 1,
  skin_color: 1,
  attribute_1: 1,
  attribute_2: 1,
  attribute_3: 1,
  bloodlineId: 2,
  read_tos: 3,
  read_privacy: 3,
  read_earlyaccess: 3,
  recruiter_userid: 3,
  musicOn: 3,
  sfxOn: 3,
  buttonSfxOn: 3,
};

/** Player-facing name of each registration field */
export const REGISTRATION_FIELD_LABELS: Record<RegistrationField, string> = {
  username: "Username",
  gender: "Gender",
  spriteBodyStyle: "Body style",
  hair_color: "Hair color",
  eye_color: "Eye color",
  skin_color: "Skin color",
  attribute_1: "First trait",
  attribute_2: "Second trait",
  attribute_3: "Third trait",
  bloodlineId: "Bloodline",
  read_tos: "Terms of Service",
  read_privacy: "Privacy Policy",
  read_earlyaccess: "Changing game agreement",
  recruiter_userid: "Recruiter",
  musicOn: "Music",
  sfxOn: "Sound effects",
  buttonSfxOn: "Button sounds",
};

/**
 * The earliest registration step holding an invalid field, and the names of the invalid
 * fields on that step, or undefined when no known field is invalid.
 */
export const firstInvalidRegistrationStep = (
  invalidFields: readonly string[],
): { step: number; labels: string[] } | undefined => {
  const known = invalidFields.filter(
    (field): field is RegistrationField => field in REGISTRATION_FIELD_STEPS,
  );
  if (known.length === 0) return undefined;
  const step = Math.min(...known.map((field) => REGISTRATION_FIELD_STEPS[field]));
  const labels = known
    .filter((field) => REGISTRATION_FIELD_STEPS[field] === step)
    .map((field) => REGISTRATION_FIELD_LABELS[field]);
  return { step, labels };
};

/**
 * Whether each registration step's required fields are filled and valid, indexed by
 * zero-based step. The final step is submitted rather than advanced, so it is never ready.
 */
export const registrationStepReadiness = (
  values: Partial<Record<RegistrationField, unknown>>,
  invalidFields: readonly string[],
): boolean[] => {
  const isFilled = (field: RegistrationField) => Boolean(values[field]);
  const isValid = (field: RegistrationField) => !invalidFields.includes(field);
  const isUsernameLongEnough =
    typeof values.username === "string" && values.username.trim().length >= 2;
  const appearanceFields = [
    "hair_color",
    "eye_color",
    "skin_color",
    "attribute_1",
    "attribute_2",
    "attribute_3",
  ] as const;
  return [
    isUsernameLongEnough &&
      isFilled("gender") &&
      isValid("username") &&
      isValid("gender"),
    appearanceFields.every((field) => isFilled(field) && isValid(field)),
    isFilled("bloodlineId") && isValid("bloodlineId"),
    false,
  ];
};
