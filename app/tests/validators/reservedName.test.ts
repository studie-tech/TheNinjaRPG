import { describe, expect, it } from "vitest";
import { CoreVillages, UserRoles } from "@/drizzle/constants";
import {
  isReservedCustomTitle,
  RESERVED_CUSTOM_TITLE_MESSAGE,
} from "@/validators/reservedName";
import { titleChangeSchema } from "@/validators/user";

describe("isReservedCustomTitle", () => {
  it.each(UserRoles.filter((role) => role !== "USER"))(
    "blocks staff role %s and common variants",
    (role) => {
      expect(isReservedCustomTitle(role)).toBe(true);
      expect(isReservedCustomTitle(role.toLowerCase())).toBe(true);
      expect(isReservedCustomTitle(role.replace(/_/g, " "))).toBe(true);
      expect(isReservedCustomTitle(role.replace(/[-_]/g, " "))).toBe(true);
    },
  );

  it.each([...CoreVillages, "Syndicate", "Horizon", "Freedom State"])(
    "blocks village or faction name %s",
    (name) => {
      expect(isReservedCustomTitle(name)).toBe(true);
      expect(isReservedCustomTitle(name.toLowerCase())).toBe(true);
      expect(isReservedCustomTitle(name.replace(/\s+/g, ""))).toBe(true);
    },
  );

  it("blocks dynamic village names from the database", () => {
    expect(isReservedCustomTitle("Custom Hamlet", ["Custom Hamlet"])).toBe(true);
    expect(isReservedCustomTitle("custom_hamlet", ["Custom Hamlet"])).toBe(true);
  });

  it("allows unrelated titles", () => {
    expect(isReservedCustomTitle("Shadow Walker")).toBe(false);
    expect(isReservedCustomTitle("Chunin")).toBe(false);
  });
});

describe("titleChangeSchema", () => {
  it("rejects reserved titles with a clear message", () => {
    const result = titleChangeSchema.safeParse({ title: "Moderator" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(RESERVED_CUSTOM_TITLE_MESSAGE);
    }
  });

  it("accepts allowed titles", () => {
    expect(titleChangeSchema.parse({ title: "Shadow Walker" })).toEqual({
      title: "Shadow Walker",
    });
  });
});
