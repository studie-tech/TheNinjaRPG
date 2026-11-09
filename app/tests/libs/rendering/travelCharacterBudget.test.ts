import { describe, expect, it } from "bun:test";
import { createTravelCharacterBudget } from "@/libs/rendering/travelCharacterBudget";

describe("travel character budget", () => {
  it("starts at the crowd ceiling and grows only after sustained headroom following backoff", () => {
    const budget = createTravelCharacterBudget();
    expect(budget.limit).toBe(100);
    for (let now = 0; now < 7000; now += 1000 / 60) budget.sample(now);
    expect(budget.limit).toBe(100);
    for (let now = 7000; now < 80_000; now += 1000 / 60) budget.sample(now);
    expect(budget.limit).toBe(100);
  });
  it("backs off quickly under sustained load and preserves a bounded minimum", () => {
    const budget = createTravelCharacterBudget();
    for (let now = 0; now < 2100; now += 1000 / 30) budget.sample(now);
    expect(budget.limit).toBe(96);
    for (let now = 2100; now < 100_000; now += 1000 / 30) budget.sample(now);
    expect(budget.limit).toBe(12);
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
