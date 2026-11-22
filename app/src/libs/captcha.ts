import {
  TRAINING_CAPTCHA_COUNT_INTERVALS,
  TRAINING_CAPTCHA_INTERVAL,
  TRAINING_CAPTCHA_MIN_TRAININGS,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { getUserFederalStatus } from "@/utils/paypal";

/**
 * Whether the next stat, Energy queue, mastery or elemental training needs a captcha.
 * Shared by the training page and `train` router so both ask at the same counts: none
 * for staff accounts or below the daily minimum, then at every Nth daily training, where N
 * is the rarer (larger) of the count-based interval and the user's federal tier interval.
 * `dailyTrainings` is capped at `MAX_DAILY_TRAININGS`, which bounds daily volume.
 */
export const showTrainingCapcha = (
  user: Pick<UserData, "dailyTrainings" | "staffAccount" | "federalStatus">,
) => {
  if (user.staffAccount) return false;
  const trainings = user.dailyTrainings;
  if (trainings < TRAINING_CAPTCHA_MIN_TRAININGS) return false;
  const countInterval =
    TRAINING_CAPTCHA_COUNT_INTERVALS.find((step) => trainings < step.below)?.every ?? 1;
  const tierInterval = TRAINING_CAPTCHA_INTERVAL[getUserFederalStatus(user)];
  return trainings % Math.max(countInterval, tierInterval) === 0;
};

/**
 * Captcha glyphs: upper case only, without look-alikes (B/8, G/6, I/1, O/0/Q/D, S/5,
 * Z/2), so the rendered value reads the same in any font and to dyslexic players.
 */
export const CAPTCHA_ALPHABET = "ACDEFHJKLMNPRTUVWXY34679";
export const CAPTCHA_LENGTH = 5;

/** Random training captcha value drawn from `CAPTCHA_ALPHABET`. */
export const randomCaptchaValue = () =>
  Array.from(
    { length: CAPTCHA_LENGTH },
    () => CAPTCHA_ALPHABET[Math.floor(Math.random() * CAPTCHA_ALPHABET.length)],
  ).join("");

/** Fold case, surrounding spaces and the O/0 look-alikes so only misread glyphs fail. */
const normalizeCaptcha = (text: string) =>
  text.trim().toLowerCase().replaceAll("0", "o");

/**
 * Whether a typed captcha answer matches the generated value. Case is ignored because the
 * rendered font makes letters such as C/c, S/s and O/o indistinguishable, and phone
 * keyboards capitalize the first letter.
 */
export const captchaAnswerMatches = (value: string, guess: string) =>
  normalizeCaptcha(value) === normalizeCaptcha(guess);
