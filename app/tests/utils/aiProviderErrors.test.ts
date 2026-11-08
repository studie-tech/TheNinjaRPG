import { describe, expect, it } from "bun:test";
import { APICallError, RetryError } from "ai";
import { APIConnectionError, RateLimitError } from "openai";
import { isAiProviderQuotaError } from "@/utils/aiProviderErrors";

const noCredits = "You have no credits remaining. Add credits to continue using the API.";
const apiCallError = (statusCode: number, message = noCredits) =>
  new APICallError({ message, url: "https://api.openai.com/v1/responses", requestBodyValues: {}, statusCode, isRetryable: statusCode === 429 });

describe("isAiProviderQuotaError", () => {
  it("recognises OpenAI SDK rate-limit and insufficient-quota errors", () => {
    expect(isAiProviderQuotaError(new RateLimitError(429, { message: noCredits }, `429 ${noCredits}`, new Headers()))).toBe(true);
    expect(isAiProviderQuotaError({ status: 400, code: "insufficient_quota" })).toBe(true);
  });

  it("recognises AI SDK call errors, including ones wrapped by retries or causes", () => {
    expect(isAiProviderQuotaError(apiCallError(429))).toBe(true);
    const retry = new RetryError({ message: "Failed after 3 attempts.", reason: "maxRetriesExceeded", errors: [apiCallError(429)] });
    expect(isAiProviderQuotaError(retry)).toBe(true);
    expect(isAiProviderQuotaError(new Error("tRPC failed", { cause: apiCallError(429) }))).toBe(true);
    expect(isAiProviderQuotaError(new Error(noCredits))).toBe(true);
  });

  it("ignores other provider failures", () => {
    expect(isAiProviderQuotaError(apiCallError(500, "Internal server error"))).toBe(false);
    expect(isAiProviderQuotaError(new APIConnectionError({ message: "Connection error." }))).toBe(false);
    expect(isAiProviderQuotaError(new Error("Image request blocked by safety system"))).toBe(false);
    expect(isAiProviderQuotaError(undefined)).toBe(false);
    expect(isAiProviderQuotaError("429")).toBe(false);
  });
});
