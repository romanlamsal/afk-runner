import type { RunGate } from "../../src/service/gate.ts"

export type FakeGate = {
    gate: RunGate
    /** Every ticket the gate was run for, in the order it was run. */
    gated: number[]
}

/**
 * The gate as the merge track sees it: something that is asked after every merge and answers green
 * or red. What the gate itself does is `test/service/gate.test.ts`.
 *
 * `red` is the tickets whose gate goes red; every other one goes green.
 */
export const createFakeGate = (red: readonly number[] = []): FakeGate => {
    const gated: number[] = []
    return {
        gated,
        gate: async (_run, ticket) => {
            gated.push(ticket)
            return red.includes(ticket) ? { outcome: "failed" } : { outcome: "ok" }
        },
    }
}
