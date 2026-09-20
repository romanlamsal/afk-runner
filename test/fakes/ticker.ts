import type { Ticker } from "../../src/domain/clock.ts"

/**
 * A ticker that beats `beats` times and ends, as soon as it is asked: a tick is scripted rather than
 * waited on, so that a test about a tick is a test and not a schedule. An abort ends it early, the
 * way it ends the real one.
 */
export const createFakeTicker = (beats = 0): Ticker =>
    async function* (_everyMs, signal) {
        for (let beat = 0; beat < beats && !signal.aborted; beat++) {
            yield
        }
    }
