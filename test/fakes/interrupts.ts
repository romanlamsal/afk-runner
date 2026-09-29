import type { Interrupts } from "../../src/domain/interrupts.ts"

export type FakeInterrupts = {
    interrupts: Interrupts
    /** The operator's first interrupt, which is the only one a run ever observes. */
    interrupt: () => void
}

/**
 * The operator's stop signal, sent by hand. A scenario interrupts at the one moment worth asserting
 * about — while something is in flight — which a real signal could never be aimed at.
 *
 * Once a viewer has taken the first interrupt it quits on it instead, and nothing drains, as with
 * the real one.
 */
export const createFakeInterrupts = (): FakeInterrupts => {
    let draining = false
    let quit: AbortController | undefined
    return {
        interrupts: {
            draining: () => draining,
            quitOnFirst: () => {
                if (quit === undefined && draining) {
                    return AbortSignal.abort()
                }
                quit ??= new AbortController()
                return quit.signal
            },
        },
        interrupt: () => {
            if (quit === undefined) {
                draining = true
            } else {
                quit.abort()
            }
        },
    }
}
