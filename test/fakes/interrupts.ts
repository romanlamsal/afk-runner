import type { Interrupts } from "../../src/domain/interrupts.ts"

export type FakeInterrupts = {
    interrupts: Interrupts
    /** The operator's first interrupt, which is the only one a run ever observes. */
    interrupt: () => void
}

/**
 * The operator's stop signal, sent by hand. A scenario interrupts at the one moment worth asserting
 * about — while something is in flight — which a real signal could never be aimed at.
 */
export const createFakeInterrupts = (): FakeInterrupts => {
    let draining = false
    return {
        interrupts: { draining: () => draining },
        interrupt: () => {
            draining = true
        },
    }
}
