import { describe, expect, it } from "bun:test";
import {
  calcJutsuTrainTime,
  findJutsuInTraining,
  inferJutsuTrainingStartedAt,
  isJutsuInTraining,
} from "@/libs/train";

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

describe("isJutsuInTraining", () => {
  const serverNow = finishTraining.getTime() + 1_000;

  it("treats a training as finished once the server clock passes finishTraining", () => {
    expect(isJutsuInTraining({ finishTraining }, finishTraining.getTime() - 1)).toBe(true);
    expect(isJutsuInTraining({ finishTraining }, finishTraining.getTime())).toBe(false);
    expect(isJutsuInTraining({ finishTraining: null }, serverNow)).toBe(false);
  });

  it("follows the server clock for a device whose clock runs behind it", () => {
    // timeDiff = device clock - server clock; a device 10 minutes slow
    const timeDiff = -10 * 60 * 1000;
    const deviceNow = serverNow + timeDiff;

    // On the device clock the training would still look active, though the server has
    // already finished it and rejects stopTraining with "Not training any jutsu".
    expect(isJutsuInTraining({ finishTraining }, deviceNow)).toBe(true);
    expect(isJutsuInTraining({ finishTraining }, deviceNow - timeDiff)).toBe(false);
  });
});

describe("findJutsuInTraining", () => {
  it("returns the row still in training and ignores finished or untrained rows", () => {
    const serverNow = finishTraining.getTime();
    const rows = [
      { id: "finished", finishTraining: new Date(serverNow - 1) },
      { id: "never", finishTraining: null },
      { id: "active", finishTraining: new Date(serverNow + 60_000) },
    ];

    expect(findJutsuInTraining(rows, serverNow)?.id).toBe("active");
    expect(findJutsuInTraining(rows.slice(0, 2), serverNow)).toBeUndefined();
    expect(findJutsuInTraining(undefined, serverNow)).toBeUndefined();
  });
});
