import { describe, expect, it } from "vitest";
import {
  MAX_ITEM_CRAFTING_REQUIREMENT_QUANTITY,
  MAX_ITEM_STACK_SIZE,
} from "@/drizzle/constants";
import { ItemValidatorRawSchema } from "@/validators/combat";

describe("item quantity limits", () => {
  const stackSizeSchema = ItemValidatorRawSchema.shape.stackSize;
  const craftingRequirementsSchema =
    ItemValidatorRawSchema.shape.craftingRequirements;

  it("accepts the maximum item stack size and rejects larger stacks", () => {
    expect(stackSizeSchema.safeParse(MAX_ITEM_STACK_SIZE).success).toBe(true);
    expect(stackSizeSchema.safeParse(MAX_ITEM_STACK_SIZE + 1).success).toBe(false);
  });

  it("accepts the maximum crafting requirement and rejects larger quantities", () => {
    expect(
      craftingRequirementsSchema.safeParse([
        { ids: ["material-id"], number: MAX_ITEM_CRAFTING_REQUIREMENT_QUANTITY },
      ]).success,
    ).toBe(true);
    expect(
      craftingRequirementsSchema.safeParse([
        {
          ids: ["material-id"],
          number: MAX_ITEM_CRAFTING_REQUIREMENT_QUANTITY + 1,
        },
      ]).success,
    ).toBe(false);
  });
});
