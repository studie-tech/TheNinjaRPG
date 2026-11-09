import { describe, expect, it } from "bun:test";
import { getNewReactions, processMentions } from "@/utils/chat";
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
      sanitize(
        content.replace("@Alice", '<a href="/username/Alice"><b>@Alice</b></a>'),
      ),
    );
  });

  it.each([
    '<p><a href="https://example.com/?name=@Alice&amp;view=profile" rel="noopener noreferrer" target="_blank">Profile</a></p>',
    '<p><img src="https://example.com/@Alice.png" alt="@Bob" width="800" height="600"></p>',
    '<blockquote author="@Alice" date="10/24/2026">Quote</blockquote>',
    '<iframe src="https://example.com/@Alice" width="800" height="600" title="@Bob"></iframe>',
  ])("preserves attributes without extracting mentions: %s", (content) => {
    expect(processMentions(content)).toEqual({
      processedContent: sanitize(content),
      mentionedUserNames: [],
    });
  });

  it("preserves an authored link while processing a genuine visible mention", () => {
    const content =
      '<p><a href="https://example.com/?name=@Alice&amp;view=profile">Profile</a> <strong>@Bob</strong></p>';
    expect(processMentions(content)).toEqual({
      processedContent: content.replace(
        "@Bob",
        '<a href="/username/Bob"><b>@Bob</b></a>',
      ),
      mentionedUserNames: ["Bob"],
    });
  });

  it.each([
    '<p><a href="/username/Alice"><b>@Alice</b></a></p>',
    '<p><a href="https://example.com/@Alice">https://example.com/@Alice</a></p>',
    '<p><a href="https://example.com/profile"><strong><em>@Alice</em></strong></a></p>',
  ])("leaves existing link content intact: %s", (content) => {
    expect(processMentions(content)).toEqual({
      processedContent: sanitize(content),
      mentionedUserNames: [],
    });
  });

  it.each(["@Alice&#95;Foo", "@Al&#105;ce_Foo", "&#64;Alice_Foo"])(
    "normalizes encoded username characters before extracting mentions: %s",
    (content) => {
      expect(processMentions(`<p>${content}</p>`)).toEqual({
        processedContent: '<p><a href="/username/Alice_Foo"><b>@Alice_Foo</b></a></p>',
        mentionedUserNames: ["Alice_Foo"],
      });
    },
  );

  it("replaces repeated mentions once without nesting links", () => {
    expect(processMentions("<p>@Alice @Alice</p>")).toEqual({
      processedContent:
        '<p><a href="/username/Alice"><b>@Alice</b></a> <a href="/username/Alice"><b>@Alice</b></a></p>',
      mentionedUserNames: ["Alice", "Alice"],
    });
  });

  it.each(["Alice(", "Alice[", "Alice.*", 'Alice"/part?x=y#z'])(
    "treats punctuation literally and encodes the profile path: %s",
    (username) => {
      expect(processMentions(`<p>@${username} Plain Alice</p>`)).toEqual({
        processedContent: `<p><a href="/username/${encodeURIComponent(username)}"><b>@${username}</b></a> Plain Alice</p>`,
        mentionedUserNames: [username],
      });
    },
  );

  it("ignores discarded content and preserves the sanitizer allowlist", () => {
    const content =
      '<script>@Alice</script><style>@Bob{}</style><p style="color:red" onclick="alert(1)">Hello @Carol</p>';
    expect(processMentions(content)).toEqual({
      processedContent:
        '<p style="color:red">Hello <a href="/username/Carol"><b>@Carol</b></a></p>',
      mentionedUserNames: ["Carol"],
    });
  });
});

describe("getNewReactions", () => {
  it("adds a new emoji after the existing ones", () => {
    const reactions = getNewReactions({ "👍": ["ann"] }, "🔥", "bob");
    expect(reactions).toEqual({ "👍": ["ann"], "🔥": ["bob"] });
    expect(Object.keys(reactions)).toEqual(["👍", "🔥"]);
  });

  it("appends a new user and removes a returning one in place", () => {
    const old = { "👍": ["ann"], "🔥": ["ann", "bob"], "❤️": ["ann"] };
    const added = getNewReactions(old, "👍", "bob");
    expect(added).toEqual({ ...old, "👍": ["ann", "bob"] });
    expect(Object.keys(added)).toEqual(Object.keys(old));
    const removed = getNewReactions(old, "🔥", "ann");
    expect(removed).toEqual({ ...old, "🔥": ["bob"] });
    expect(Object.keys(removed)).toEqual(Object.keys(old));
  });

  it("drops an emoji with its last user and lets an empty list gain one", () => {
    expect(getNewReactions({ "👍": ["ann"], "🔥": ["bob"] }, "👍", "ann")).toEqual({
      "🔥": ["bob"],
    });
    expect(getNewReactions({ "👍": [] }, "👍", "ann")).toEqual({ "👍": ["ann"] });
  });

  it("removes every copy of a duplicated user", () => {
    expect(getNewReactions({ "👍": ["ann", "ann", "bob"] }, "👍", "ann")).toEqual({
      "👍": ["bob"],
    });
  });

  it("returns the original object for an unusable emoji and never mutates it", () => {
    const old = { "👍": ["ann"] };
    expect(getNewReactions(old, "", "bob")).toBe(old);
    expect(getNewReactions(old, "<script></script>", "bob")).toBe(old);
    expect(getNewReactions(old, "a".repeat(11), "bob")).toBe(old);
    getNewReactions(old, "👍", "ann");
    getNewReactions(old, "👍", "bob");
    expect(old).toEqual({ "👍": ["ann"] });
  });

  it("keys on the sanitized emoji", () => {
    expect(getNewReactions({}, "<b>x</b>", "ann")).toEqual({
      [sanitize("<b>x</b>")]: ["ann"],
    });
  });
});
