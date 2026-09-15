import { describe, expect, it } from "vitest"
import { createStreamReader } from "../../src/infrastructure/stream-json.ts"

/**
 * Lines as the CLI emits them under `-p --output-format stream-json --verbose --json-schema`,
 * trimmed to the fields afk reads. The first line carries a session id and arrives before any model
 * work, which is what makes an observed id cheap (ADR-0017).
 */
const RATE_LIMIT = JSON.stringify({ type: "rate_limit_event", session_id: "b6424495" })
const INIT = JSON.stringify({ type: "system", subtype: "init", session_id: "b6424495" })
const structured = (input: unknown): string =>
    JSON.stringify({
        type: "assistant",
        session_id: "b6424495",
        message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "toolu_1", name: "StructuredOutput", input }],
        },
    })

const STRUCTURED = structured({ name: "Bob", number: 7 })
const TEXT = JSON.stringify({
    type: "assistant",
    session_id: "b6424495",
    message: { role: "assistant", content: [{ type: "text", text: "planning" }] },
})

const read = (lines: readonly string[]) => {
    const reader = createStreamReader()
    for (const line of lines) {
        reader.read(line)
    }
    return reader.reading()
}

describe("createStreamReader", () => {
    it("should observe the session id the stream carries", () => {
        // given
        const lines = [RATE_LIMIT, INIT, STRUCTURED]

        // when
        const reading = read(lines)

        // then
        expect(reading.sessionId).toBe("b6424495")
    })

    it("should observe no session id when the stream carried none", () => {
        // given
        const lines = [JSON.stringify({ type: "system" })]

        // when
        const reading = read(lines)

        // then
        expect(reading.sessionId).toBeUndefined()
    })

    it("should read the structured output out of its tool call", () => {
        // given
        const lines = [RATE_LIMIT, INIT, STRUCTURED]

        // when
        const reading = read(lines)

        // then
        expect(reading.structuredOutput).toEqual({ name: "Bob", number: 7 })
    })

    it("should read no structured output from a stream that carried none", () => {
        // given
        const lines = [RATE_LIMIT, TEXT]

        // when
        const reading = read(lines)

        // then
        expect(reading.structuredOutput).toBeUndefined()
    })

    it("should keep the last structured output when the agent produced more than one", () => {
        // given
        const lines = [STRUCTURED, structured({ name: "Bob", number: 8 })]

        // when
        const reading = read(lines)

        // then
        expect(reading.structuredOutput).toEqual({ name: "Bob", number: 8 })
    })

    it.each([
        ["a blank line", ""],
        ["a line that is not json", "not json"],
        ["a line that is not an object", "[]"],
    ] as const)("should survive %s in the stream", (_name, line) => {
        // given
        const lines = [RATE_LIMIT, line, STRUCTURED]

        // when
        const reading = read(lines)

        // then
        expect(reading.structuredOutput).toEqual({ name: "Bob", number: 7 })
    })
})
