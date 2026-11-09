import { describe, expect, it } from "bun:test";
import { FORM_LABEL_MAP } from "@/layout/EditContent";
import { getObjectiveSchema } from "@/validators/objectives";

// Each id-list objective field must exist in its schema and have a FORM_LABEL_MAP
// entry; without one the objective editor labels the picker with the raw field name.
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
    });
  }
});
