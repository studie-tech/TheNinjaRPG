import { describe, expect, it } from "vitest";
import { boostTemplateSchema } from "@/validators/shrine";

describe("boostTemplateSchema", () => {
  it("accepts the full weekly grid capacity", () => {
    const entries = Array.from({ length: 7 * 12 }, (_, slotOffset) => {
      const dayOfWeek = Math.floor(slotOffset / 12);
      const slotIndex = slotOffset % 12;

      return [
        {
          boostType: "Training" as const,
          dayOfWeek,
          slotIndex,
        },
        {
          boostType: "PVP" as const,
          dayOfWeek,
          slotIndex,
        },
        {
          boostType: "Mission" as const,
          dayOfWeek,
          slotIndex,
        },
        {
          boostType: "Errands" as const,
          dayOfWeek,
          slotIndex,
        },
        {
          boostType: "Crafting" as const,
          dayOfWeek,
          slotIndex,
        },
      ];
    }).flat();

    const result = boostTemplateSchema.safeParse(entries);

    expect(entries).toHaveLength(420);
    expect(result.success).toBe(true);
  });

  it("rejects templates larger than the full weekly grid capacity", () => {
    const entries = Array.from({ length: 421 }, (_, index) => ({
      boostType: "Training" as const,
      dayOfWeek: Math.floor(index / 12) % 7,
      slotIndex: index % 12,
    }));

    const result = boostTemplateSchema.safeParse(entries);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Template cannot exceed 420 entries",
    );
  });
});
