import { describe, expect, it } from "bun:test";
import { TERMINAL_DIALOG_PREFIX } from "@/drizzle/constants";
import { dialogChoiceContentId } from "@/libs/objectives";

describe("dialogChoiceContentId", () => {
  it("follows a branch to its next objective", () => {
    expect(dialogChoiceContentId("next", "dialog-1")).toBe("next");
  });

  it("sends the objective-scoped sentinel for a terminal branch", () => {
    expect(dialogChoiceContentId(undefined, "dialog-1")).toBe(
      `${TERMINAL_DIALOG_PREFIX}dialog-1`,
    );
  });
});
