/** Local CLI for the existing preview broker. Bun loads app/.env using dotenv syntax. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { devPaths, devStatus } from "../../scripts/dev-server.mjs";
import {
  aiTestUserCallEndpointRequestSchema,
  aiTestUserRequestSchema,
  aiTestUserResponseSchema,
} from "@/validators/ai-test-user";

const paths = devPaths();
const artifactDir = join(paths.root, "app/scripts/.artifacts");
const credentials = join(artifactDir, "dev-users.json");
const readInput = async (file: string) =>
  JSON.parse(await readFile(resolve(paths.root, file), "utf8"));

async function main() {
  const action = process.argv[2];
  if (action === "doctor") {
    const database = new URL(process.env.DATABASE_URL || "http://unconfigured");
    console.log(
      JSON.stringify(
        {
          ...(await devStatus(paths)),
          databaseTarget: `${database.protocol}//${database.host}${database.pathname}`,
          brokerConfigured: Boolean(process.env.AI_TEST_USER_BROKER_TOKEN),
          clerkConfigured: Boolean(process.env.CLERK_SECRET_KEY),
          credentials,
        },
        null,
        2,
      ),
    );
    return;
  }
  const status = await devStatus(paths);
  if (status.phase !== "ready")
    throw new Error("This worktree's server is not ready. Run make dev-up first.");
  const token = process.env.AI_TEST_USER_BROKER_TOKEN;
  if (!token)
    throw new Error(
      "AI_TEST_USER_BROKER_TOKEN is missing in app/.env (make dev-doctor). Configure the real env file; do not export secrets by hand.",
    );
  const callBroker = async (route: string, input: unknown) => {
    const response = await fetch(`${status.url}/api/ai-test-user${route}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
      headers: { "Content-Type": "application/json", "x-tnr-reviewer-token": token },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok || !result.success)
      throw new Error(
        `Broker ${response.status}: ${result.message || JSON.stringify(result.errors) || "request failed"}`,
      );
    return result;
  };
  if (action === "provision") {
    if (!process.env.REQUEST)
      throw new Error("Use make dev-user REQUEST=<JSON file containing {users:[...]}>");
    const input = aiTestUserRequestSchema.parse(await readInput(process.env.REQUEST));
    // Identical labels in different worktrees/runs must never reset each other's users.
    input.runId ??= `local-${paths.key}-${crypto.randomUUID().slice(0, 8)}`;
    const result = aiTestUserResponseSchema.parse(await callBroker("", input));
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    const temporaryCredentials = `${credentials}.${crypto.randomUUID()}.tmp`;
    await writeFile(
      temporaryCredentials,
      JSON.stringify(
        {
          ...result,
          url: status.url,
          runId: input.runId,
          users: result.users.map((user) => ({
            ...user,
            loginUrl: user.signInToken
              ? `${status.url}/login?__clerk_ticket=${encodeURIComponent(user.signInToken)}`
              : null,
          })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await rename(temporaryCredentials, credentials);
    console.log(
      JSON.stringify(
        {
          credentials,
          runId: input.runId,
          users: result.users.map(({ key, username, userId }) => ({
            key,
            username,
            userId,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === "call") {
    const saved = JSON.parse(await readFile(credentials, "utf8"));
    const users = aiTestUserResponseSchema.parse(saved).users;
    const user = users.find((user) => user.key === process.env.USER_KEY);
    if (!user)
      throw new Error(
        `Choose USER_KEY from ${credentials}: ${users.map((user) => user.key).join(", ")}`,
      );
    if (saved.url !== status.url)
      throw new Error(
        "The server URL changed; provision users on the current server before calling endpoints.",
      );
    const request = aiTestUserCallEndpointRequestSchema.parse({
      userId: user.userId,
      endpointName: process.env.ENDPOINT,
      input: process.env.INPUT_FILE
        ? await readInput(process.env.INPUT_FILE)
        : undefined,
    });
    const result = await callBroker("/call-endpoint", request);
    console.log(JSON.stringify(result, null, 2));
    if (result.result?.success === false) process.exitCode = 1;
    return;
  }
  throw new Error("Use make dev-user, dev-call, or dev-doctor.");
}

main().catch((error: unknown) => {
  console.error(`dev-user: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
