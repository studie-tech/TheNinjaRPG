// @ts-check
/**
 * This file is included in `/next.config.mjs` which ensures the app isn't built with invalid env vars.
 * It has to be a `.mjs`-file to be imported there.
 */
import { serverSchema, serverEnv } from "./schema.mjs";
import { env as clientEnv, formatErrors } from "./client.mjs";

// If this ever runs in the browser, it means server env was imported into a client bundle.
if (typeof window !== "undefined") {
  throw new Error("server env imported in a client bundle (src/env/server.mjs)");
}

const _serverEnv = serverSchema.safeParse(serverEnv);

if (!_serverEnv.success) {
  console.error(
    "❌ Invalid environment variables:\n",
    ...formatErrors(_serverEnv.error.format()),
  );
  throw new Error("Invalid environment variables");
}

for (let key of Object.keys(_serverEnv.data)) {
  if (key.startsWith("NEXT_PUBLIC_")) {
    console.warn("❌ You are exposing a server-side env-variable:", key);
    throw new Error("You are exposing a server-side env-variable");
  }
}

export const env = { ..._serverEnv.data, ...clientEnv };

