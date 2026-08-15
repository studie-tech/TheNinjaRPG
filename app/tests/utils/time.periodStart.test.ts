import { describe, it, expect } from "vitest";
import { periodStart } from "@/utils/time";

describe("periodStart", () => {
  it("daily → UTC midnight of the same day", () => {
    expect(periodStart("daily", new Date("2026-06-19T23:58:00Z")).toISOString())
      .toBe("2026-06-19T00:00:00.000Z");
  });
  it("weekly → Monday 00:00 UTC of the ISO week (Fri→Mon)", () => {
    expect(periodStart("weekly", new Date("2026-06-19T12:00:00Z")).toISOString())
      .toBe("2026-06-15T00:00:00.000Z"); // Mon 2026-06-15
  });
  it("weekly → Sunday belongs to the week starting the prior Monday", () => {
    expect(periodStart("weekly", new Date("2026-06-21T12:00:00Z")).toISOString())
      .toBe("2026-06-15T00:00:00.000Z");
  });
  it("weekly → crosses the year boundary without changing ISO-week semantics", () => {
    expect(periodStart("weekly", new Date("2027-01-01T12:00:00Z")).toISOString())
      .toBe("2026-12-28T00:00:00.000Z");
  });
  it("monthly → 1st 00:00 UTC", () => {
    expect(periodStart("monthly", new Date("2026-06-30T23:59:59Z")).toISOString())
      .toBe("2026-06-01T00:00:00.000Z");
  });
});
