import type { z } from "zod"
import { toJSONSchema } from "zod"

/**
 * A role's structured output schema, as the agent is handed it: generated at runtime and inlined.
 *
 * `$schema` is dropped because the CLI validates against a validator with no meta-schema registered
 * for the draft it names, and rejects a document carrying one outright.
 */
export const inlineJsonSchema = (schema: z.ZodType): z.core.JSONSchema.BaseSchema => {
    const { $schema, ...rest } = toJSONSchema(schema)
    return rest
}
