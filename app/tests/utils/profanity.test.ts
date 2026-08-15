import { describe, expect, it } from "vitest";
import { checkForBadWords } from "@/utils/profanity";

const expectFlagged = async (content: string, detail: string) => {
  await expect(checkForBadWords(content)).resolves.toEqual({
    success: false,
    message: expect.stringContaining(`Details: ${detail}`),
  });
};

const expectAllowed = async (content: string) => {
  await expect(checkForBadWords(content)).resolves.toEqual({
    success: true,
    message: "Comment passed moderation",
  });
};

describe("checkForBadWords", () => {
  it("flags exact offensive words regardless of case", async () => {
    await expectFlagged("That was FuCkEd.", "fucked");
  });

  it("flags username-style single-token variants", async () => {
    await expectFlagged("faggoty", "faggoty");
  });

  it.each(["alligator bait", "alligator-bait"])(
    "flags offensive phrases joined by spaces or hyphens: %s",
    async (content) => {
      await expectFlagged(content, "alligator bait");
    },
  );

  it.each([
    "alligator used as bait",
    "alligator? bait",
    "alligator, bait",
    "alligator\nbait",
  ])("does not flag phrase tokens across unrelated text or boundaries: %s", async (content) => {
    await expectAllowed(content);
  });

  it.each(["ali baba", "ang mo", "bounty bar", "choc ice", "full blood"])(
    "allows removed low-signal phrases: %s",
    async (content) => {
      await expectAllowed(content);
    },
  );
});
