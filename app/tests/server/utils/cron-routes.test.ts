// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../../..");
const config = JSON.parse(readFileSync(resolve(appRoot, "vercel.json"), "utf8")) as {
  crons: { path: string }[];
};
// Include periodic maintenance routes that are currently not in the deployment schedule.
const periodic = readdirSync(resolve(appRoot, "src/app/api"))
  .filter((name) => /^(daily|hourly|weekly|monthly)-/.test(name))
  .map((name) => `/api/${name}`);
const routes = [...new Set([...config.crons.map((cron) => cron.path), ...periodic])];

it.each(routes)("%s authenticates before timers or other work", (route) => {
  const file = resolve(appRoot, `src/app${route}/route.ts`);
  const source = readFileSync(file, "utf8");
  expect(source).toContain('import { authenticateCronRequest } from "@/server/utils/cron";');
  // Require the guard at the start of either established GET handler declaration.
  // This catches newly scheduled endpoints and work accidentally placed before auth.
  expect(source).toMatch(/export (?:async function GET\(request: Request\)|const GET = async \(request: Request\) =>) \{\s*const authError = authenticateCronRequest\(request\);\s*if \(authError\) return authError;/);
});
