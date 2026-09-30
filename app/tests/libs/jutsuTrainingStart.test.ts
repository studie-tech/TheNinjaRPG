import { describe, expect, it } from "vitest";
import { calcJutsuTrainTime, inferJutsuTrainingStartedAt } from "@/libs/train";

const finishTraining = new Date("2026-01-02T00:00:00.000Z");

describe("inferJutsuTrainingStartedAt", () => {
  it("uses the duration of the level training began at, not the stored target level", () => {
    const jutsu = { jutsuRank: "D" as const };
    const userdata = { senseiId: null, rank: "CHUNIN" as const };
    const startedAt = inferJutsuTrainingStartedAt(finishTraining, jutsu, 5, userdata);

    expect(finishTraining.getTime() - startedAt.getTime()).toBe(
      calcJutsuTrainTime(jutsu, 4, userdata),
    );
  });

  it("applies the genin sensei discount from the same rules as training start", () => {
    const jutsu = { jutsuRank: "C" as const };
    const userdata = { senseiId: "sensei", rank: "GENIN" as const };
    const startedAt = inferJutsuTrainingStartedAt(finishTraining, jutsu, 1, userdata);

    expect(finishTraining.getTime() - startedAt.getTime()).toBe(
      calcJutsuTrainTime(jutsu, 0, userdata),
    );
    expect(calcJutsuTrainTime(jutsu, 0, userdata)).toBeLessThan(
      calcJutsuTrainTime(jutsu, 0, { senseiId: null, rank: "GENIN" }),
    );
  });
});
