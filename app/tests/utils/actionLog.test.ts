import { describe, expect, it } from "bun:test";
import { ACTION_LOG_RELATED_MSG_MAX_LENGTH } from "@/drizzle/constants";
import { clampActionLogText } from "@/utils/actionLog";

describe("clampActionLogText", () => {
  it("leaves text within the column width untouched", () => {
    expect(clampActionLogText("Short reason")).toBe("Short reason");
    const exact = "a".repeat(ACTION_LOG_RELATED_MSG_MAX_LENGTH);
    expect(clampActionLogText(exact)).toBe(exact);
  });

  it("truncates long text to the relatedText column width", () => {
    const reason = `Updated attempted. Reason rejected by AI: ${"x".repeat(400)}`;
    const clamped = clampActionLogText(reason);
    expect(clamped).toHaveLength(ACTION_LOG_RELATED_MSG_MAX_LENGTH);
    expect(reason.startsWith(clamped)).toBe(true);
  });

  it("counts by code point and never splits a surrogate pair", () => {
    const text = "🍥".repeat(ACTION_LOG_RELATED_MSG_MAX_LENGTH + 10);
    const clamped = clampActionLogText(text);
    expect(Array.from(clamped)).toHaveLength(ACTION_LOG_RELATED_MSG_MAX_LENGTH);
    expect(clamped).toBe("🍥".repeat(ACTION_LOG_RELATED_MSG_MAX_LENGTH));
  });

  it("keeps emoji text that fits in code points even if UTF-16 length exceeds the limit", () => {
    const text = "🍥".repeat(150);
    expect(clampActionLogText(text)).toBe(text);
  });
});
