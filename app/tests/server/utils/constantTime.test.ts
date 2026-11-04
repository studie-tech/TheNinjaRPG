import { describe, expect, it } from "bun:test";
import { constantTimeEquals } from "@/server/utils/constantTime";

describe("constantTimeEquals", () => {
  it("matches identical strings only", () => {
    expect(constantTimeEquals("Bearer secret", "Bearer secret")).toBe(true);
    expect(constantTimeEquals("Bearer secret", "Bearer secreT")).toBe(false);
  });

  it("rejects a different length without throwing", () => {
    expect(constantTimeEquals("short", "much longer value")).toBe(false);
  });

  it("compares bytes, so a same-length non-ASCII value cannot throw", () => {
    expect(constantTimeEquals("abcd", "abcé")).toBe(false);
  });
});
