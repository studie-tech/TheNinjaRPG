import { describe, expect, it } from "bun:test";
import { createTravelCharacterBudget } from "@/libs/rendering/travelCharacterBudget";

describe("travel character budget", () => {
  it("starts at the crowd ceiling and grows only after sustained headroom following backoff", () => {
    const budget = createTravelCharacterBudget();
    expect(budget.limit).toBe(100);
    for (let now = 0; now < 2100; now += 1000 / 30) budget.sample(now);
    expect(budget.limit).toBe(96);
    for (let now = 2100; now < 9100; now += 1000 / 60) budget.sample(now);
    expect(budget.limit).toBe(96);
    for (let now = 9100; now < 40_000; now += 1000 / 60) budget.sample(now);
    expect(budget.limit).toBe(100);
  });
  it("backs off quickly under sustained load and preserves a bounded minimum", () => {
    const budget = createTravelCharacterBudget();
    for (let now = 0; now < 2100; now += 1000 / 30) budget.sample(now);
    expect(budget.limit).toBe(96);
    for (let now = 2100; now < 100_000; now += 1000 / 30) budget.sample(now);
    expect(budget.limit).toBe(12);
  });
  it.each([250, 251, 300, 500])(
    "reduces the budget to its minimum with sustained %d ms frames",
    (interval) => {
      const budget = createTravelCharacterBudget();
      let changes = 0;
      for (let now = 0; now <= 60_000; now += interval)
        changes += Number(budget.sample(now));
      expect(budget.limit).toBe(12);
      expect(changes).toBe(22);
    },
  );
  it("backs off when slow frames vary across the long-gap boundary", () => {
    const budget = createTravelCharacterBudget();
    let now = 0;
    budget.sample(now);
    while (now < 100_000) {
      for (const interval of [200, 300, 250, 251, 500]) {
        now += interval;
        budget.sample(now);
      }
    }
    expect(budget.limit).toBe(12);
  });
  it.each([251, 500, 60_000])(
    "excludes an isolated %d ms gap and waits for fresh sustained load",
    (gap) => {
      const budget = createTravelCharacterBudget();
      let now = 0;
      budget.sample(now);
      for (let i = 0; i < 119; i++) {
        now += 16;
        budget.sample(now);
      }
      now += gap;
      expect(budget.sample(now)).toBe(false);
      for (let i = 0; i < 125; i++) {
        now += 16;
        budget.sample(now);
      }
      expect(budget.limit).toBe(100);
      for (let i = 0; i < 59; i++) {
        now += 34;
        budget.sample(now);
      }
      expect(budget.limit).toBe(96);
    },
  );
  it("requires four healthy windows to recover after severe load and a suspension", () => {
    const budget = createTravelCharacterBudget();
    let now = 0;
    for (; now <= 60_000; now += 500) budget.sample(now);
    expect(budget.limit).toBe(12);
    now += 60_000;
    budget.sample(now);
    for (let i = 0; i < 499; i++) {
      now += 16;
      budget.sample(now);
    }
    expect(budget.limit).toBe(12);
    now += 16;
    expect(budget.sample(now)).toBe(true);
    expect(budget.limit).toBe(16);
    for (let i = 0; i < 20_000; i++) {
      now += 16;
      budget.sample(now);
    }
    expect(budget.limit).toBe(100);
  });
  it("does not treat hidden-tab gaps or a short loading stall as sustained load", () => {
    const budget = createTravelCharacterBudget();
    budget.sample(0);
    budget.sample(60_000);
    for (let now = 60_017; now < 61_000; now += 1000 / 60) budget.sample(now);
    budget.sample(61_200);
    expect(budget.limit).toBe(100);
  });
});
