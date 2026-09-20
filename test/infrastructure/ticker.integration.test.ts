import { describe, expect, it } from "vitest"
import { createIntervalTicker } from "../../src/infrastructure/ticker.ts"

/** The ticker against node's own timers, which is the whole of what it talks to. */
describe("createIntervalTicker", () => {
    it("should end rather than throw once its signal aborts", async () => {
        // given: a ticker stopped at its third beat
        const stopping = new AbortController()
        let beats = 0

        // when
        for await (const _ of createIntervalTicker()(1, stopping.signal)) {
            beats += 1
            if (beats === 3) {
                stopping.abort()
            }
        }

        // then
        expect(beats).toEqual(3)
    })
})
