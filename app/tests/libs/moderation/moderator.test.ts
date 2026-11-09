import { afterEach, describe, expect, it, vi } from "bun:test";
import { Moderations } from "openai/resources/moderations";
import { classifyNsfwImage } from "@/libs/moderator";

afterEach(() => vi.restoreAllMocks());

describe("classifyNsfwImage", () => {
  it("fails closed when strict image moderation returns no result", async () => {
    vi.spyOn(Moderations.prototype, "create").mockImplementation(
      () => Promise.resolve({ results: [] }) as never,
    );
    await expect(
      classifyNsfwImage("https://example.com/pet.webp", true),
    ).rejects.toThrow("did not return a result");
  });
});
