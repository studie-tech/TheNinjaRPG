import { describe, expect, it } from "bun:test";
import {
  cloneAiUsernameCandidates,
  pickCloneAiUsername,
  USERNAME_MAX_LENGTH,
} from "@/libs/profile";

describe("cloneAiUsernameCandidates", () => {
  it("numbers copies after the first", () => {
    expect(cloneAiUsernameCandidates("Training Dummy", 3)).toEqual([
      "Training Dummy - copy",
      "Training Dummy - copy 2",
      "Training Dummy - copy 3",
    ]);
  });

  it("reuses the original name when cloning a copy", () => {
    expect(cloneAiUsernameCandidates("Training Dummy - copy", 1)).toEqual([
      "Training Dummy - copy",
    ]);
    expect(cloneAiUsernameCandidates("Training Dummy - copy 7", 2)).toEqual([
      "Training Dummy - copy",
      "Training Dummy - copy 2",
    ]);
  });

  it("keeps every candidate within the username length", () => {
    const long = "x".repeat(USERNAME_MAX_LENGTH);
    const candidates = cloneAiUsernameCandidates(long, 12);
    for (const name of candidates) {
      expect(name.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
    }
    expect(candidates[0]?.endsWith(" - copy")).toBe(true);
    expect(candidates[11]?.endsWith(" - copy 12")).toBe(true);
    expect(new Set(candidates).size).toBe(12);
  });
});

describe("pickCloneAiUsername", () => {
  const candidates = cloneAiUsernameCandidates("Training Dummy", 3);

  it("takes the first free name", () => {
    expect(pickCloneAiUsername(candidates, [])).toBe("Training Dummy - copy");
    expect(pickCloneAiUsername(candidates, ["Training Dummy - copy"])).toBe(
      "Training Dummy - copy 2",
    );
  });

  it("compares case-insensitively, like the unique key", () => {
    expect(pickCloneAiUsername(candidates, ["training dummy - COPY"])).toBe(
      "Training Dummy - copy 2",
    );
  });

  it("returns undefined when every candidate is taken", () => {
    expect(pickCloneAiUsername(candidates, candidates)).toBeUndefined();
  });
});
