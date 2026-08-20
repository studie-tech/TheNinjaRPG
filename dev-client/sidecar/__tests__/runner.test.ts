import { expect, test } from "bun:test";
import { parseAgentUsage } from "../runner";

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
