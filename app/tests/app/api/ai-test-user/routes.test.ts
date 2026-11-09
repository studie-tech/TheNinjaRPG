import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { POST as callEndpoint } from "@/app/api/ai-test-user/call-endpoint/route";
import { POST as provisionUsers } from "@/app/api/ai-test-user/route";
import { restoreEnvAfterEach } from "../../../setup/env";

restoreEnvAfterEach("VERCEL_ENV", "NODE_ENV", "AI_TEST_USER_BROKER_TOKEN");
const brokerToken = "test-broker-token";

beforeEach(() => {
  Object.assign(process.env, {
    VERCEL_ENV: "preview",
    NODE_ENV: "production",
    AI_TEST_USER_BROKER_TOKEN: brokerToken,
  });
});

afterEach(() => {
  mock.restore();
});

describe.each([
  ["provision users", provisionUsers, "AI test-user broker"],
  ["call endpoint", callEndpoint, "Call-endpoint broker"],
] as const)("%s authorization", (_name, handler, brokerName) => {
  it.each(["production", "development", undefined])(
    "rejects a non-preview deployment (%s) before parsing the body",
    async (vercelEnv) => {
      if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = vercelEnv;
      const request = brokerRequest(brokerToken);
      const parseBody = spyOn(request, "json");

      const response = await handler(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        success: false,
        message: `${brokerName} is only available in preview`,
      });
      expect(parseBody).not.toHaveBeenCalled();
    },
  );

  it("checks the environment before server-token configuration", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AI_TEST_USER_BROKER_TOKEN;

    expect((await handler(brokerRequest())).status).toBe(403);
  });

  it.each([undefined, ""])(
    "fails closed when the server token is unconfigured (%s)",
    async (token) => {
      if (token === undefined) delete process.env.AI_TEST_USER_BROKER_TOKEN;
      else process.env.AI_TEST_USER_BROKER_TOKEN = token;
      const request = brokerRequest(brokerToken);
      const parseBody = spyOn(request, "json");

      const response = await handler(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        success: false,
        message: "AI test-user broker token is not configured",
      });
      expect(parseBody).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", "wrong-token", `Bearer ${brokerToken}`])(
    "rejects a missing or incorrect reviewer token (%s) before parsing the body",
    async (token) => {
      const request = brokerRequest(token);
      const parseBody = spyOn(request, "json");

      const response = await handler(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        success: false,
        message: "Unauthorized",
      });
      expect(parseBody).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["preview", "production"],
    [undefined, "development"],
    ["production", "development"],
  ] as const)(
    "reaches body parsing with the correct token in VERCEL_ENV=%s, NODE_ENV=%s",
    async (vercelEnv, nodeEnv) => {
      if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = vercelEnv;
      Object.assign(process.env, { NODE_ENV: nodeEnv });
      const request = brokerRequest(brokerToken);
      const parseBody = spyOn(request, "json");

      const response = await handler(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        message: "Invalid JSON body",
      });
      expect(parseBody).toHaveBeenCalledTimes(1);
    },
  );
});

const brokerRequest = (token?: string) => {
  // An Authorization header alone must never substitute for the broker's own header.
  const headers = new Headers({ authorization: `Bearer ${brokerToken}` });
  if (token !== undefined) headers.set("x-tnr-reviewer-token", token);
  // Authorized requests stop at parsing, before provisioning or any database access.
  return new Request("https://example.com/api/ai-test-user", {
    method: "POST",
    headers,
    body: "invalid JSON",
  });
};
