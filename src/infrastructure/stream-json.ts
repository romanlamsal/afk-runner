import { z } from "zod"
import type { AgentUsage } from "../domain/agent.ts"

/**
 * Reading the agent CLI's `stream-json` output. Three things afk needs are in there and nowhere
 * else: the session id, which every line carries including the first one — emitted before any model
 * work — the structured output, which arrives as the input of a `StructuredOutput` tool call, and
 * the token counts, which arrive once on the terminal `result` line.
 *
 * The stream is somebody else's format, so it is read defensively: a line that is not JSON, or not
 * shaped as expected, is a line afk has no use for rather than a failure of the attempt.
 */

/** The tool the agent CLI calls to report structured output. */
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput"

/** The terminal line of a stream, and the only one carrying what the attempt consumed. */
const RESULT_LINE = "result"

/**
 * The two counts a `result` line always carries are required; the two cache counts are defaulted,
 * because the API legitimately omits them when they are zero.
 *
 * Requiring the first two is what keeps `usage: {}` from reading as an attempt that consumed
 * nothing: a shape afk does not recognise leaves the usage **absent**, which is the distinction the
 * event log rests on.
 */
const usageLine = z.looseObject({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
    cache_read_input_tokens: z.number().nonnegative().default(0),
    cache_creation_input_tokens: z.number().nonnegative().default(0),
})

const streamLine = z.looseObject({
    type: z.string().optional(),
    session_id: z.string().optional(),
    usage: usageLine.optional(),
    message: z
        .looseObject({
            content: z.array(z.looseObject({ type: z.string(), name: z.string().optional() })).optional(),
        })
        .optional(),
})

export type StreamReading = {
    /** The first session id the stream carried. */
    sessionId: string | undefined
    /** The input of the last structured-output tool call, exactly as the agent gave it. */
    structuredOutput: unknown
    /** What the `result` line said the attempt consumed, where it carried one at all. */
    usage: AgentUsage | undefined
}

export type StreamReader = {
    /** One line of the stream, without its newline. */
    read: (line: string) => void
    reading: () => StreamReading
}

const parse = (line: string): unknown => {
    try {
        return JSON.parse(line)
    } catch {
        return undefined
    }
}

export const createStreamReader = (): StreamReader => {
    let sessionId: string | undefined
    let structuredOutput: unknown
    let usage: AgentUsage | undefined

    return {
        reading: () => ({ sessionId, structuredOutput, usage }),
        read: line => {
            const parsed = streamLine.safeParse(parse(line))
            if (!parsed.success) {
                return
            }

            sessionId ??= parsed.data.session_id
            for (const block of parsed.data.message?.content ?? []) {
                if (block.type === "tool_use" && block.name === STRUCTURED_OUTPUT_TOOL) {
                    structuredOutput = block.input
                }
            }

            // Only off the terminal line: the per-message counts on the way past are one turn each,
            // and summing them would double-count the history every turn re-sends.
            const counts = parsed.data.type === RESULT_LINE ? parsed.data.usage : undefined
            if (counts !== undefined) {
                usage = usageOf(counts)
            }
        },
    }
}

const usageOf = (counts: z.infer<typeof usageLine>): AgentUsage => ({
    inputTokens: counts.input_tokens,
    outputTokens: counts.output_tokens,
    cacheReadInputTokens: counts.cache_read_input_tokens,
    cacheCreationInputTokens: counts.cache_creation_input_tokens,
})
