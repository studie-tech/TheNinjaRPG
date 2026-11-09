import { describe, expect, it } from "bun:test";
import {
  ANBU_HOSPITAL_DISCOUNT_PERC,
  BANK_INTEREST_CLAIM_DAYS,
  BANK_INTEREST_DAILY_CAP,
  ERRANDS_PER_DAY,
  FED_BANK_INTEREST,
  HOSPITAL_BASE_HEAL_SECONDS,
  HOSPITAL_RYO_PER_100_HP,
  MAX_ATTRIBUTES,
  MEDNIN_REQUIRED_EXP,
  MISSIONS_PER_DAY,
  RYO_FOR_REP_MIN_REPS,
  RYO_FOR_REP_RESERVE,
  TRAINING_SPEED_CONFIG,
  TrainingSpeeds,
} from "@/drizzle/constants";
import { getDefaultBasicActions } from "@/libs/combat/actions";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { calcJutsuEquipLimit } from "@/libs/jutsuRequirements";
import { SUPPORT_CHAT_INSTRUCTIONS } from "@/libs/supportPrompt";
import { calcBankInterest } from "@/utils/village";

const prompt = SUPPORT_CHAT_INSTRUCTIONS;
const thousands = (exp: number) => `${exp / 1000}k`;

describe("support chat prompt", () => {
  it("describes the hospital base stay, its boosts and the paid heal from constants", () => {
    expect(prompt).not.toContain("2-minute wait");
    expect(prompt).toContain(
      `Recovery takes ${HOSPITAL_BASE_HEAL_SECONDS / 60} minutes (${HOSPITAL_BASE_HEAL_SECONDS} seconds) before village hospital boosts, which shorten it`,
    );
    expect(prompt).toContain(
      `${HOSPITAL_RYO_PER_100_HP} ryo per 100 missing HP, ${ANBU_HOSPITAL_DISCOUNT_PERC}% less for ANBU members`,
    );
  });

  it("lists every medical ninja rank threshold", () => {
    expect(prompt).toContain(
      `Novice from Genin, Apprentice at ${thousands(MEDNIN_REQUIRED_EXP.APPRENTICE)}, Master at ${thousands(MEDNIN_REQUIRED_EXP.MASTER)} and Legendary at ${thousands(MEDNIN_REQUIRED_EXP.LEGENDARY)} medical experience`,
    );
  });

  it("states the bank rate rule and a cap that applies to every tier", () => {
    expect(prompt).not.toContain("1.9%");
    expect(prompt).not.toContain("without federal support");
    expect(prompt).toContain(`base rate of ${calcBankInterest(0)}% per day`);
    expect(prompt).toContain(
      `Federal support adds ${FED_BANK_INTEREST.NORMAL}, ${FED_BANK_INTEREST.SILVER} or ${FED_BANK_INTEREST.GOLD} percentage points`,
    );
    expect(prompt).toContain(
      `capped at ${BANK_INTEREST_DAILY_CAP.toLocaleString("en-US")} ryo per day for every federal tier`,
    );
    expect(prompt).toContain(`within ${BANK_INTEREST_CLAIM_DAYS} days`);
  });

  it("renders the ryo-for-rep minimum and reserve from constants", () => {
    expect(prompt).not.toContain("cannot sell below");
    expect(prompt).toContain(
      `each listing must offer at least ${RYO_FOR_REP_MIN_REPS} reputation points, and the last ${RYO_FOR_REP_RESERVE} reputation points you own cannot be sold`,
    );
  });

  it("describes collectible titles rather than a paid custom title", () => {
    expect(prompt).not.toContain("15-character limit");
    expect(prompt).toContain("Display one of your collected titles");
    expect(prompt).toContain(`Choose up to ${MAX_ATTRIBUTES} traits`);
  });

  it("lists every training interval with its efficiency", () => {
    for (const speed of TrainingSpeeds) {
      const { seconds, efficiency } = TRAINING_SPEED_CONFIG[speed];
      const hours = seconds / 3600;
      const length =
        seconds < 3600
          ? `${seconds / 60} minutes`
          : `${hours} hour${hours === 1 ? "" : "s"}`;
      expect(prompt).toContain(`- ${length}: ${efficiency}% efficiency.`);
    }
    expect(prompt).toContain(`up to ${ERRANDS_PER_DAY} per day`);
    expect(prompt).toContain(`up to ${MISSIONS_PER_DAY} per day`);
  });

  it("states basic action costs from the combat definitions", () => {
    const actions = getDefaultBasicActions({ rank: "GENIN" });
    const {
      basicAttack,
      basicOffensiveStance,
      basicCleanse,
      basicClear,
      basicMeditate,
    } = actions;
    expect(prompt).toContain(`${COMBAT_SECONDS}-second turn timer`);
    expect(prompt).toContain(
      `Costs ${basicAttack.actionCostPerc} AP and ${basicAttack.staminaCost} SP; has a ${basicAttack.cooldown}-round cooldown`,
    );
    expect(prompt).toContain(
      `increases damage dealt by ${basicOffensiveStance.effects[0]?.power}% for ${basicOffensiveStance.effects[0]?.rounds} round`,
    );
    expect(prompt).toContain(
      `Costs ${basicMeditate.actionCostPerc} AP; has a ${basicMeditate.cooldown}-round cooldown`,
    );
    expect(prompt).toContain(
      `Costs ${basicClear.actionCostPerc} AP, has a ${basicClear.range}-hex range and a ${basicClear.cooldown}-round cooldown`,
    );
    expect(prompt).toContain(
      `Costs ${basicCleanse.actionCostPerc} AP with a ${basicCleanse.cooldown}-round cooldown`,
    );
    expect(prompt).toContain("when you cannot afford any remaining action");
  });

  it("states jutsu slots per rank from the equip limit", () => {
    const slots = (rank: "GENIN" | "CHUNIN" | "JONIN" | "ELITE JONIN") =>
      calcJutsuEquipLimit({
        rank,
        staffAccount: false,
        extraJutsuSlots: 0,
        federalStatus: "NONE",
      });
    expect(prompt).toContain(
      `**Slots:** ${slots("GENIN")} at Genin, ${slots("CHUNIN")} at Chunin and ${slots("JONIN")} at Jonin (${slots("ELITE JONIN")} at Elite Jonin)`,
    );
  });
});
