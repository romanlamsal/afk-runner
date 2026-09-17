import type { FixRedGate } from "../../src/service/fix.ts"

export type FakeFix = {
    fix: FixRedGate
    /** Every ticket the red gate's recovery was handed, in the order it was handed over. */
    attempted: number[]
}

/**
 * The red gate's recovery as the merge track sees it: something a red gate is handed to, which says
 * whether the ticket survived it. What the recovery itself does is `test/service/fix.test.ts`.
 *
 * `fixed` is the tickets whose fix attempt makes the gate green; every other one is reverted and
 * failed.
 */
export const createFakeFix = (fixed: readonly number[] = []): FakeFix => {
    const attempted: number[] = []
    return {
        attempted,
        fix: async (_run, ticket) => {
            attempted.push(ticket.number)
            return fixed.includes(ticket.number) ? { outcome: "ok" } : { outcome: "failed" }
        },
    }
}
