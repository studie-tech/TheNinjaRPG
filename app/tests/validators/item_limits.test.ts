import { describe, expect, it } from "bun:test";
import {
  ItemTypes,
  MAX_ITEM_CRAFTING_REQUIREMENT_QUANTITY,
  MAX_ITEM_STACK_SIZE,
} from "@/drizzle/constants";
import { ItemValidatorRawSchema } from "@/validators/combat";

describe("item quantity limits", () => {
  const stackSizeSchema = ItemValidatorRawSchema.shape.stackSize;
  const craftingRequirementsSchema = ItemValidatorRawSchema.shape.craftingRequirements;

  it("accepts COOKING as a persisted item type", () => {
    expect(ItemTypes).toContain("COOKING");
    expect(ItemValidatorRawSchema.shape.itemType.safeParse("COOKING").success).toBe(
      true,
    );
    expect(
      ItemValidatorRawSchema.shape.crystalTargetTypes.safeParse("COOKING").success,
    ).toBe(true);
  });

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

describe("item crafting requirements", () => {
  const schema = ItemValidatorRawSchema.shape.craftingRequirements;
  const entry = { ids: ["a"], number: 1 };

  it("defaults a missing list, keeps null and rejects anything else", () => {
    expect(schema.parse(undefined)).toEqual([]);
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse([entry])).toEqual([entry]);
    expect(schema.isOptional()).toBe(true);
    expect(schema.isNullable()).toBe(true);
    expect(schema.safeParse("a").error?.issues[0]?.message).toBe(
      "Invalid input: expected array, received string",
    );
  });
});
