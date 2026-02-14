import { jsonSchema } from "ai";
import type { JSONSchema7 } from "json-schema";
import type { ZodType } from "zod";
import { z } from "zod";

/**
 * Converts a Zod schema to an OpenAI compatible schema.
 * @param input - The Zod schema to convert.
 * @returns The OpenAI compatible schema.
 */
export const convertToOpenaiCompatibleSchema = <T extends ZodType>(input: T) => {
  const schema = jsonSchema(
    z.toJSONSchema(input, { target: "draft-07" }) as JSONSchema7,
  );
  return schema;
};
