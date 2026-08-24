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
  // These schemas describe tool INPUTS, so serialize the input side: the
  // output side throws for validators containing .transform() (item, jutsu,
  // bloodline), since transformed output types have no JSON Schema form.
  const schema = jsonSchema(
    z.toJSONSchema(input, { target: "draft-07", io: "input" }) as JSONSchema7,
  );
  return schema;
};
