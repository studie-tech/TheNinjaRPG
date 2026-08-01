import { describe, expect, it } from "vitest";
import { item, jutsu } from "@/drizzle/schema";
import { setEmptyStringsToNulls, setNullsToEmptyStrings } from "@/utils/typeutils";

describe("setEmptyStringsToNulls", () => {
  it("nulls empty strings when no table is given", () => {
    const data: Record<string, unknown> = { a: "", b: "keep", c: 0 };
    setEmptyStringsToNulls(data);
    expect(data).toEqual({ a: null, b: "keep", c: 0 });
  });

  it("leaves NOT NULL columns as empty strings", () => {
    // THENINJARPG-2P0: Item.battleDescription is NOT NULL with a '' default, so
    // nulling a blank one made every item.update fail with errno 1048.
    const data: Record<string, unknown> = { battleDescription: "", description: "" };
    setEmptyStringsToNulls(data, item);
    expect(data.battleDescription).toBe("");
  });

  it("still nulls nullable columns when a table is given", () => {
    const data: Record<string, unknown> = { bloodlineId: "", statClassification: "" };
    setEmptyStringsToNulls(data, jutsu);
    expect(data.bloodlineId).toBeNull();
    expect(data.statClassification).toBeNull();
  });

  it("ignores keys that are not columns on the table", () => {
    const data: Record<string, unknown> = { notAColumn: "" };
    setEmptyStringsToNulls(data, item);
    expect(data.notAColumn).toBeNull();
  });

  it("round-trips with setNullsToEmptyStrings for nullable columns", () => {
    const data: Record<string, unknown> = { bloodlineId: null };
    setNullsToEmptyStrings(data);
    expect(data.bloodlineId).toBe("");
    setEmptyStringsToNulls(data, jutsu);
    expect(data.bloodlineId).toBeNull();
  });

  it("tolerates null and undefined objects", () => {
    expect(() => setEmptyStringsToNulls(null)).not.toThrow();
    expect(() => setEmptyStringsToNulls(undefined, item)).not.toThrow();
  });
});
