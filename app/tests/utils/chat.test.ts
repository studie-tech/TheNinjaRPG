import { describe, expect, it } from "bun:test";
import { processMentions } from "@/utils/chat";
import sanitize from "@/utils/sanitize";

describe("processMentions", () => {
  it.each([
    "Hello @Alice",
    "Hello @Alice ",
    "Hello @Alice  ",
    "<p>Hello @Alice</p>",
    "<p>Hello @Alice&nbsp; </p>",
    "<p>Hello @Alice</p><p>Next paragraph</p>",
    "<p>Hello <strong>@Alice</strong></p>",
  ])("links and extracts mentions at text boundaries: %s", (content) => {
    const { processedContent, mentionedUserNames } = processMentions(content);
    expect(mentionedUserNames).toEqual(["Alice"]);
    expect(sanitize(processedContent)).toBe(
      sanitize(content.replace("@Alice", '<a href="/username/Alice"><b>@Alice</b></a>')),
    );
  });
});
