import { describe, expect, it } from "vitest"
import { createSignalInterrupts } from "../../src/infrastructure/interrupts.ts"

/**
 * The one place an interrupt is handled at all, so that no step has to (ADR-0016). The signal and
 * the exit arrive as arguments, which is what makes the two-interrupt rule assertable without a
 * process to send signals to.
 */
const harness = () => {
    const handlers: Array<() => void> = []
    const draining: string[] = []
    const killed: string[] = []
    let kills = 0
    const interrupts = createSignalInterrupts({
        listen: handler => handlers.push(handler),
        kill: () => {
            kills += 1
        },
        notifyDraining: line => draining.push(line),
        notifyKilled: line => killed.push(line),
    })
    return {
        interrupts,
        draining,
        killed,
        interrupt: (): void => {
            for (const handler of handlers) {
                handler()
            }
        },
        kills: (): number => kills,
    }
}

describe("createSignalInterrupts", () => {
    it("should not be draining while nobody has interrupted the run", () => {
        // given
        const { interrupts } = harness()

        // when
        const draining = interrupts.draining()

        // then
        expect(draining).toBe(false)
    })

    it("should drain from the first interrupt on, so that nothing new starts", () => {
        // given
        const { interrupts, interrupt } = harness()

        // when
        interrupt()

        // then
        expect(interrupts.draining()).toBe(true)
    })

    it("should tell the operator that a second interrupt is what kills the run", () => {
        // given
        const { interrupt, draining } = harness()

        // when
        interrupt()

        // then
        expect(draining.at(0)).toMatch(/again/)
    })

    // The two notices leave by different doors, because the board owns the terminal while the run
    // is going and owns nothing at all the moment after the kill (ADR-0029).
    it("should say nothing about a kill on the first interrupt", () => {
        // given
        const { interrupt, killed } = harness()

        // when
        interrupt()

        // then
        expect(killed).toEqual([])
    })

    it("should tell the operator the run is gone through the kill's own route", () => {
        // given
        const { interrupt, killed } = harness()
        interrupt()

        // when
        interrupt()

        // then
        expect(killed.at(0)).toMatch(/killed/)
    })

    // The first interrupt is the drain, and every one after it is the operator saying they meant
    // it — which is never answered by doing nothing.
    it.each([
        { interrupts: 1, kills: 0 },
        { interrupts: 2, kills: 1 },
        { interrupts: 3, kills: 2 },
    ] as const)("should kill $kills times over $interrupts interrupts", ({ interrupts, kills }) => {
        // given
        const run = harness()

        // when
        for (let sent = 0; sent < interrupts; sent += 1) {
            run.interrupt()
        }

        // then
        expect(run.kills()).toBe(kills)
    })
})
