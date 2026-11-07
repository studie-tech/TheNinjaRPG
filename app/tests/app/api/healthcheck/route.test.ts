import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as nextHeaders from "next/headers";
import { GET } from "@/app/api/healthcheck/route";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";

const shellOrigin = "capacitor://localhost";

beforeEach(() => {
  vi.spyOn(nextHeaders, "headers").mockResolvedValue(
    new Headers({ origin: shellOrigin }) as never,
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

it("answers OK with the shell's CORS header while a user row is readable", async () => {
  stubProfile("findUserDataForGET", () => Promise.resolve({ username: "user" }));
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toBe("OK");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(shellOrigin);
});

it("answers 404 with the shell's CORS header when no user exists", async () => {
  stubProfile("findUserDataForGET", () => Promise.resolve(undefined));
  const response = await GET();
  expect(response.status).toBe(404);
  expect(response.ok).toBe(false);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(shellOrigin);
});

it("answers 500 with the shell's CORS header when the read fails", async () => {
  stubProfile("findUserDataForGET", () => Promise.reject(new Error("database down")));
  const response = await GET();
  expect(response.status).toBe(500);
  expect(await response.json()).toBe("Internal server error");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(shellOrigin);
});
