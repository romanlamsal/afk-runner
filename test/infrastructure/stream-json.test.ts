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

/**
 * The terminal line, and the only one afk reads token counts off. The `usage` on the assistant
 * lines before it is one turn each, and every turn re-sends the history, so summing them would
 * count that history once per turn.
 */
const RESULT = JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "b6424495",
    total_cost_usd: 0.42,
    usage: {
        input_tokens: 1600,
        output_tokens: 29700,
        cache_read_input_tokens: 1600000,
        cache_creation_input_tokens: 86500,
    },
})

const TURN = JSON.stringify({
    type: "assistant",
    session_id: "b6424495",
    message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        usage: { input_tokens: 999, output_tokens: 999 },
    },
})

describe("createStreamReader, reading what an attempt consumed", () => {
    it.each([
        ["inputTokens", 1600],
        ["outputTokens", 29700],
        ["cacheReadInputTokens", 1600000],
        ["cacheCreationInputTokens", 86500],
    ] as const)("should read %s off the result line", (count, expected) => {
        // given
        const lines = [INIT, TURN, RESULT]

        // when
        const reading = read(lines)

        // then
        expect(reading.usage?.[count]).toBe(expected)
    })

    it("should read no usage when the stream carried no result line", () => {
        // given
        const lines = [INIT, TURN, STRUCTURED]

        // when
        const reading = read(lines)

        // then
        expect(reading.usage).toBeUndefined()
    })

    it("should default the cache counts, which the API omits when they are zero", () => {
        // given
        const lines = [INIT, JSON.stringify({ type: "result", usage: { input_tokens: 12, output_tokens: 34 } })]

        // when
        const reading = read(lines)

        // then
        expect(reading.usage).toEqual({
            inputTokens: 12,
            outputTokens: 34,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
        })
    })

    it("should leave the usage absent for a result line whose usage it does not recognise", () => {
        // given
        const lines = [INIT, JSON.stringify({ type: "result", usage: {} })]

        // when
        const reading = read(lines)

        // then
        expect(reading.usage).toBeUndefined()
    })

    it("should ignore the per-turn counts, which every turn re-sends the history behind", () => {
        // given
        const lines = [INIT, TURN, TURN, TURN]

        // when
        const reading = read(lines)

        // then
        expect(reading.usage).toBeUndefined()
    })
})
