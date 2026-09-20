import { setInterval } from "node:timers/promises"
import type { Ticker } from "../domain/clock.ts"

/**
 * The ticker over node's own interval. An abort is how every caller stops it, so it ends the
 * iterable here instead of arriving as an error the caller would have to tell apart from a real one.
 */
export const createIntervalTicker = (): Ticker =>
    async function* (everyMs, signal) {
        try {
            for await (const _ of setInterval(everyMs, undefined, { signal })) {
                yield
            }
        } catch (error) {
            if (!signal.aborted) {
                throw error
            }
        }
    }
