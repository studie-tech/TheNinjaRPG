import { describe, expect, it } from "bun:test";
import type { FederalStatus } from "@/drizzle/constants";
import {
  CAPTCHA_ALPHABET,
  CAPTCHA_LENGTH,
  captchaAnswerMatches,
  randomCaptchaValue,
  showTrainingCapcha,
} from "@/libs/captcha";

const user = (
  federalStatus: FederalStatus,
  dailyTrainings: number,
  staffAccount = false,
) => ({
  federalStatus,
  dailyTrainings,
  staffAccount,
});

describe("showTrainingCapcha", () => {
  // The rarer (larger) of the count-based interval (4 below 30, 3 below 40, 2 below 50,
  // then 1) and the tier interval (NONE 2, NORMAL 3, SILVER 4, GOLD 5) applies.
  const cases: [FederalStatus, number, boolean][] = [
    ["NONE", 9, false],
    ["NONE", 10, false],
    ["NONE", 12, true],
    ["NONE", 14, false],
    ["NONE", 16, true],
    ["NONE", 30, true],
    ["NONE", 32, false],
    ["NONE", 33, true],
    ["NONE", 40, true],
    ["NONE", 41, false],
    ["NONE", 63, false],
    ["NONE", 64, true],
    ["NORMAL", 10, false],
    ["NORMAL", 12, true],
    ["NORMAL", 15, false],
    ["NORMAL", 16, true],
    ["NORMAL", 33, true],
    ["NORMAL", 42, true],
    ["NORMAL", 44, false],
    ["NORMAL", 51, true],
    ["NORMAL", 52, false],
    ["SILVER", 10, false],
    ["SILVER", 12, true],
    ["SILVER", 33, false],
    ["SILVER", 36, true],
    ["SILVER", 52, true],
    ["SILVER", 54, false],
    ["GOLD", 5, false],
    ["GOLD", 10, true],
    ["GOLD", 12, false],
    ["GOLD", 15, true],
    ["GOLD", 51, false],
    ["GOLD", 55, true],
    ["GOLD", 64, false],
  ];
  it.each(cases)("%s at %i daily trainings -> %p", (status, trainings, expected) => {
    expect(showTrainingCapcha(user(status, trainings))).toBe(expected);
  });

  it("never asks more often than the count-based rule or the tier rule", () => {
    const perTier = (status: FederalStatus) =>
      Array.from({ length: 60 }, (_, i) => i + 10).filter((n) =>
        showTrainingCapcha(user(status, n)),
      ).length;
    expect(perTier("NONE")).toBe(24);
    expect(perTier("NORMAL")).toBe(19);
    expect(perTier("SILVER")).toBe(15);
    expect(perTier("GOLD")).toBe(12);
  });

  it("uses the GOLD cadence for staff accounts", () => {
    expect(showTrainingCapcha(user("NONE", 12, true))).toBe(false);
    expect(showTrainingCapcha(user("NONE", 15, true))).toBe(true);
  });
});

describe("captchaAnswerMatches", () => {
  it.each([
    ["aBcD5x", "aBcD5x", true],
    ["aBcD5x", "AbCd5X", true],
    ["aBcD5x", " abcd5x ", true],
    ["Oo0abc", "0OoABC", true],
    ["aBcD5x", "aBcD5", false],
    ["aBcD5x", "aBcDSx", false],
  ])("%s vs %p -> %p", (value, guess, expected) => {
    expect(captchaAnswerMatches(value, guess)).toBe(expected);
  });
});

describe("randomCaptchaValue", () => {
  it("uses upper case glyphs without look-alikes", () => {
    for (const glyph of "BGIOQSZ0125815abcdefghijklmnopqrstuvwxyz") {
      expect(CAPTCHA_ALPHABET).not.toContain(glyph);
    }
  });

  it("draws fixed-length values from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const value = randomCaptchaValue();
      expect(value).toHaveLength(CAPTCHA_LENGTH);
      for (const glyph of value) expect(CAPTCHA_ALPHABET).toContain(glyph);
    }
  });
});
