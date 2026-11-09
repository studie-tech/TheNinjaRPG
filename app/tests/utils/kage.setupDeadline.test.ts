import { describe, expect, it } from "bun:test";
import { getKageSetupDeadline } from "@/utils/kage";

const tenure = new Date("2026-10-20T10:00:00.000Z");
const base = {
  kageId: "kage",
  leaderUpdatedAt: tenure,
  kageScheduleAvailableAt: new Date("2026-10-01T00:00:00.000Z"),
};
const schedule = {
  kageId: "kage",
  tenure: tenure.toISOString(),
  windows: [],
  publishedAt: null,
  missedStarts: 0,
  paused: false,
  observedAt: tenure.toISOString(),
};

describe("getKageSetupDeadline", () => {
  it("derives the initial deadline before reconciliation persists one", () => {
    expect(getKageSetupDeadline({ ...base, kageSchedule: null })).toEqual(
      new Date("2026-10-21T10:00:00.000Z"),
    );
  });

  it("uses the persisted, possibly extended, deadline of the current tenure", () => {
    const setupDueAt = "2026-10-22T18:00:00.000Z";
    expect(
      getKageSetupDeadline({ ...base, kageSchedule: { ...schedule, setupDueAt } }),
    ).toEqual(new Date(setupDueAt));
  });

  it("ignores a predecessor's schedule and clears once published", () => {
    expect(
      getKageSetupDeadline({
        ...base,
        kageSchedule: {
          ...schedule,
          kageId: "old",
          setupDueAt: "2026-10-01T00:00:00.000Z",
        },
      }),
    ).toEqual(new Date("2026-10-21T10:00:00.000Z"));
    expect(
      getKageSetupDeadline({
        ...base,
        kageSchedule: { ...schedule, publishedAt: tenure.toISOString() },
      }),
    ).toBeNull();
  });
});
