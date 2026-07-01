import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FORM_LABEL_MAP } from "@/layout/EditContent";
import { getObjectiveSchema } from "@/validators/objectives";

// tag_usage_win.tagType is a single curated enum. The EditContent generic
// ZodEnum branch renders it as a curated select dropdown from the enum options,
// so the only editor wiring required is a human-readable FORM_LABEL_MAP entry.
// This test pins both halves: the schema field stays a non-empty enum, and the
// editor labels it (otherwise it renders as a raw `tagType` dropdown).
describe("EditContent tag_usage_win tagType picker", () => {
  it("tagType is a curated enum the editor renders as a dropdown", () => {
    const schema = getObjectiveSchema("tag_usage_win");
    expect("tagType" in schema.shape).toBe(true);
    const field = (schema.shape as Record<string, z.ZodType>).tagType;
    const inner =
      field instanceof z.ZodDefault || field instanceof z.ZodPrefault
        ? (field.unwrap() as z.ZodType)
        : field;
    expect(inner instanceof z.ZodEnum).toBe(true);
    expect((inner as z.ZodEnum).options.length).toBeGreaterThan(0);
  });

  it("the editor labels the tagType field", () => {
    const label = FORM_LABEL_MAP.tagType;
    expect(label).toBeTruthy();
    expect((label ?? "").length).toBeGreaterThan(0);
  });
});
