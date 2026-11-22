import { describe, expect, it } from "bun:test";
import { getExpressTrialsUserUpdate } from "@/deltas/profile";

describe("Express Trials cache update", () => {
  it("withholds the update when the progression could not be projected", () => {
    expect(
      getExpressTrialsUserUpdate({ step: 33, sector: 7, progression: undefined }),
    ).toEqual({});
  });
});
