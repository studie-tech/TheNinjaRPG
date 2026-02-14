// @ts-check
import { z } from "zod";
import { clientEnv, clientSchema } from "./schema.mjs";

const _clientEnv = clientSchema.safeParse(clientEnv);

/** @param {import("zod").ZodError} error */
export const formatErrors = (error) =>
  error.issues
    .map((/** @type {any} */ issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

if (!_clientEnv.success) {
  console.error(
    "❌ Invalid environment variables:\n",
    formatErrors(_clientEnv.error),
  );
  throw new Error("Invalid environment variables");
}

for (let key of Object.keys(_clientEnv.data)) {
  if (!key.startsWith("NEXT_PUBLIC_")) {
    console.warn(
      `❌ Invalid public environment variable name: ${key}. It must begin with 'NEXT_PUBLIC_'`,
    );

    throw new Error("Invalid public environment variable name");
  }
}

export const env = _clientEnv.data;
