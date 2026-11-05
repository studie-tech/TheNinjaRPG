import { describe, expect, it } from "bun:test";
import { freeResetNote } from "@/libs/skillReset";

describe("freeResetNote", () => {
  it("counts the remaining shared allowance", () => {
    expect(freeResetNote(false, 2)).toBe("2 free resets remaining");
    expect(freeResetNote(false, 1, "free shared resets")).toBe(
      "1 free shared resets remaining",
    );
  });

  it("checks staff first, since staff resets do not consume the allowance", () => {
    expect(freeResetNote(true, 2)).toBe("Free for staff");
  });

  it("treats a free reset without allowance as a staff reset", () => {
    expect(freeResetNote(false, 0)).toBe("Free for staff");
  });
});
