import { z } from "zod"

/**
 * Reading the agent CLI's `stream-json` output. Two things afk needs are in there and nowhere else:
 * the session id, which every line carries including the first one — emitted before any model work
 * — and the structured output, which arrives as the input of a `StructuredOutput` tool call.
 *
 * The stream is somebody else's format, so it is read defensively: a line that is not JSON, or not
 * shaped as expected, is a line afk has no use for rather than a failure of the attempt.
 */

/** The tool the agent CLI calls to report structured output. */
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput"

const streamLine = z.looseObject({
    session_id: z.string().optional(),
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

    return {
        reading: () => ({ sessionId, structuredOutput }),
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
        },
    }
}
