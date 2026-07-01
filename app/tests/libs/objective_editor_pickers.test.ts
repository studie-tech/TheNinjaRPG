import { describe, expect, it } from "vitest";
import { FORM_LABEL_MAP } from "@/layout/EditContent";
import { getObjectiveSchema } from "@/validators/objectives";

// Each new specific-X objective task must (a) expose its id-list field in the
// schema and (b) carry a FORM_LABEL_MAP entry, or the EditContent render chain
// falls through to the `allowAddNew` free-text branch and silently renders a
// text box instead of the intended db_values picker. This locks each field name
// and its editor label together so a new picker field can't silently regress.
const ID_LIST_PICKERS = [
  { task: "craft_specific_item", field: "craftItemIds" },
  { task: "train_specific_jutsu", field: "trainJutsuIds" },
  { task: "complete_specific_quest", field: "completeQuestIds" },
  { task: "buy_item", field: "buyItemIds" },
  { task: "use_specific_item_combat", field: "useItemIds" },
  { task: "use_specific_jutsu_combat", field: "useJutsuIds" },
] as const;

describe("EditContent specific-X id-list pickers", () => {
  for (const { task, field } of ID_LIST_PICKERS) {
    it(`${task} exposes ${field} and the editor labels it`, () => {
      const schema = getObjectiveSchema(task);
      expect(field in schema.shape).toBe(true);
      const label = FORM_LABEL_MAP[field];
      expect(label).toBeTruthy();
      expect((label ?? "").length).toBeGreaterThan(0);
    });
  }
});
