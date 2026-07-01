import { describe, expectTypeOf, it } from "vitest";
import type { ObjectiveTrackerTaskInput } from "@/libs/quest";

describe("ObjectiveTrackerTaskInput", () => {
  it("is exported from @/libs/quest with the getNewTrackers task-update shape", () => {
    // Compile-time contract: a fully-specified task-update is assignable.
    const sample: ObjectiveTrackerTaskInput = {
      task: "craft_specific_item",
      increment: 1,
      value: 0,
      text: "Won",
      contentId: "item-id",
      warFoe: false,
    };
    expectTypeOf(sample.task).toEqualTypeOf<
      ObjectiveTrackerTaskInput["task"]
    >();
    // Minimal form (only the required discriminator) is also valid.
    const minimal: ObjectiveTrackerTaskInput = { task: "any" };
    expectTypeOf(minimal).toMatchTypeOf<ObjectiveTrackerTaskInput>();
  });
});
