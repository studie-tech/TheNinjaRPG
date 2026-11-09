import { describe, expect, it } from "bun:test";
import { createPollSchema } from "@/validators/poll";

const poll = { title: "Village names", description: "Choose a name for the village" };

describe("poll creation options", () => {
  it.each(
    [
      [],
      [
        { type: "text", text: "" },
        { type: "text", text: "  \n" },
      ],
      [
        { type: "text", text: "One" },
        { type: "text", text: " " },
      ],
    ].map((options) => ({ options })),
  )("requires two options after removing blank text rows", ({ options }) => {
    const result = createPollSchema.safeParse({ ...poll, options });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["options"],
          message: "Add at least two non-empty poll options",
        }),
      );
  });

  it("normalizes mixed options identically on client and server", () => {
    const parsed = createPollSchema.parse({
      ...poll,
      options: [
        { type: "text", text: " " },
        { type: "text", text: "  One  " },
        { type: "user", userId: "user-1", username: "Player" },
      ],
    });
    expect(parsed.options).toEqual([
      { type: "text", text: "One" },
      { type: "user", userId: "user-1", username: "Player" },
    ]);
    expect(createPollSchema.parse(parsed)).toEqual(parsed);
  });

  it("allows polls made entirely of user options", () => {
    const parsed = createPollSchema.parse({
      ...poll,
      options: [
        { type: "text", text: "" },
        { type: "text", text: "" },
        { type: "user", userId: "user-1", username: "Player One" },
        { type: "user", userId: "user-2", username: "Player Two" },
      ],
    });
    expect(parsed.options).toHaveLength(2);
    expect(parsed.options.every((option) => option.type === "user")).toBe(true);
  });

  it("keeps row validation paths before removing blank rows", () => {
    const result = createPollSchema.safeParse({
      ...poll,
      options: [
        { type: "text", text: "" },
        { type: "text", text: "x".repeat(256) },
        { type: "user", userId: " ", username: "Player" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ["options", 1, "text"],
        ["options", 2, "userId"],
      ]);
  });
});
