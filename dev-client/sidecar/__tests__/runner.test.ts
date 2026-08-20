import { describe, expect, test } from "bun:test";
import { extractAgentText, parseAgentUsage } from "../runner";

const assistant = (input: number, output: number) =>
  JSON.stringify({
    type: "assistant",
    message: { usage: { input_tokens: input, output_tokens: output } },
  });

const result = (input: number, output: number) =>
  JSON.stringify({
    type: "result",
    total_cost_usd: 0.01,
    usage: { input_tokens: input, output_tokens: output },
  });

test("parseAgentUsage takes the final cumulative usage event", () => {
  const lines = [assistant(10, 20), assistant(15, 30), result(25, 50)];
  expect(parseAgentUsage(lines)).toEqual({ tokensIn: 25, tokensOut: 50 });
});

test("parseAgentUsage falls back to the last message usage without a result", () => {
  const lines = [assistant(7, 11), assistant(9, 13)];
  expect(parseAgentUsage(lines)).toEqual({ tokensIn: 9, tokensOut: 13 });
});

test("parseAgentUsage ignores non-JSON noise and empty input", () => {
  const lines = ["warning: something", "{broken", "", assistant(3, 4)];
  expect(parseAgentUsage(lines)).toEqual({ tokensIn: 3, tokensOut: 4 });
  expect(parseAgentUsage([])).toEqual({ tokensIn: 0, tokensOut: 0 });
});

test("parseAgentUsage keeps the last usage when several events carry it", () => {
  const lines = [result(1, 2), assistant(5, 6), result(8, 9)];
  expect(parseAgentUsage(lines)).toEqual({ tokensIn: 8, tokensOut: 9 });
});

describe("parseAgentUsage cache tokens", () => {
  test("counts cache creation and cache read as input tokens", () => {
    // Cache reads dominate an agentic run; counting only input_tokens
    // under-reported real spend several-fold and the number drives the cap.
    const usage = parseAgentUsage([
      JSON.stringify({
        type: "result",
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 700,
          output_tokens: 50,
        },
      }),
    ]);
    expect(usage.tokensIn).toBe(1000);
    expect(usage.tokensOut).toBe(50);
  });

  test("still works when only input_tokens is present", () => {
    const usage = parseAgentUsage([
      JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }),
    ]);
    expect(usage).toEqual({ tokensIn: 7, tokensOut: 3 });
  });
});

describe("extractAgentText", () => {
  test("returns the terminal result rather than the raw JSON stream", () => {
    // The CLIs run in JSON mode, so posting run.output verbatim published a
    // wall of events to the public repo instead of the review.
    const text = extractAgentText([
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "thinking" }] },
      }),
      JSON.stringify({ type: "result", result: "The actual review body." }),
    ]);
    expect(text).toBe("The actual review body.");
    expect(text).not.toContain('"type"');
  });

  test("falls back to assistant text blocks when there is no result event", () => {
    const text = extractAgentText([
      JSON.stringify({
        message: { role: "assistant", content: [{ type: "text", text: "part one" }] },
      }),
      JSON.stringify({
        message: { role: "assistant", content: [{ type: "text", text: "part two" }] },
      }),
    ]);
    expect(text).toBe("part one\n\npart two");
  });

  test("reads codex's last_agent_message", () => {
    expect(
      extractAgentText([JSON.stringify({ last_agent_message: "codex says hi" })]),
    ).toBe("codex says hi");
  });

  test("truncates bodies past GitHub's comment limit", () => {
    const text = extractAgentText([
      JSON.stringify({ type: "result", result: "x".repeat(70_000) }),
    ]);
    expect(text.length).toBeLessThan(65_536);
    expect(text.endsWith("_(truncated)_")).toBe(true);
  });
});
