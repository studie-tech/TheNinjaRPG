import { describe, expect, it } from "bun:test";
import { SHRINE_BOOST_SLOTS_PER_DAY, SHRINE_BOOST_TYPES } from "@/drizzle/constants";
import { boostTemplateSchema } from "@/validators/shrine";

describe("boostTemplateSchema", () => {
  const capacity = 7 * SHRINE_BOOST_SLOTS_PER_DAY * SHRINE_BOOST_TYPES.length;
  const grid = Array.from({ length: 7 * SHRINE_BOOST_SLOTS_PER_DAY }, (_, slotOffset) =>
    SHRINE_BOOST_TYPES.map((boostType) => ({
      boostType,
      dayOfWeek: Math.floor(slotOffset / SHRINE_BOOST_SLOTS_PER_DAY),
      slotIndex: slotOffset % SHRINE_BOOST_SLOTS_PER_DAY,
    })),
  ).flat();

  it("accepts the full weekly grid capacity", () => {
    const result = boostTemplateSchema.safeParse(grid);

    expect(grid).toHaveLength(capacity);
    expect(result.success).toBe(true);
  });

  it("rejects templates larger than the full weekly grid capacity", () => {
    const entries = [...grid, grid[0]!];

    const result = boostTemplateSchema.safeParse(entries);
    const messages = result.error?.issues.map((i) => i.message) ?? [];

    expect(result.success).toBe(false);
    expect(messages).toContain(`Template cannot exceed ${capacity} entries`);
  });
});
