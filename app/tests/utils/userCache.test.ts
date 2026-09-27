import { describe, expect, it } from "vitest";
import { withDailyTrainingsDelta } from "@/utils/userCache";

describe("withDailyTrainingsDelta", () => {
  const base = { dailyTrainings: 63, offence: 10, ninjutsuMastery: 0 };

  it("counts each stop from the cache it lands on", () => {
    const afterCombat = withDailyTrainingsDelta(base, { offence: 20 }, 1);
    const afterBoth = withDailyTrainingsDelta(afterCombat, { ninjutsuMastery: 30 }, 1);

    expect(afterBoth.dailyTrainings).toBe(65);
    expect(afterBoth.offence).toBe(20);
    expect(afterBoth.ninjutsuMastery).toBe(30);
  });

  it("leaves the counter alone when a stop earned nothing", () => {
    const next = withDailyTrainingsDelta({ dailyTrainings: 4, offence: 10 }, { offence: 10 }, 0);
    expect(next.dailyTrainings).toBe(4);
  });
});
