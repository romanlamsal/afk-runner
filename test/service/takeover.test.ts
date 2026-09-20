import { describe, expect, it } from "vitest"
import type { Holder } from "../../src/domain/lock.ts"
import { createTakeOverService, type TakeOverResult } from "../../src/service/takeover.ts"
import { createFakeOperator, type FakeOperator } from "../fakes/operator.ts"
import { createFakeRunLock, type FakeRunLock, type FakeRunLockSetup } from "../fakes/run-lock.ts"

/** The afk already running spec 4, as its lock names it. */
const HOLDER: Holder = { pid: 7 }

type Setup = {
    /** Whether there is a terminal to ask on. */
    interactive?: boolean
    /** What the operator said to the offer. */
    takesOver?: boolean
    /** How the holder behaves once asked to go. */
    holder?: FakeRunLockSetup
    /** How long the holder takes to go of its own accord, where it goes at all. */
    goesAfterMs?: number | undefined
}

type Harness = {
    takeOver: () => Promise<TakeOverResult>
    lock: FakeRunLock
    operator: FakeOperator
}

const harness = (setup: Setup = {}): Harness => {
    const lock = createFakeRunLock({ heldBy: HOLDER, ...setup.holder })
    const operator = createFakeOperator({ takesOver: setup.takesOver ?? true })
    let waited = 0
    const service = createTakeOverService({
        lock: lock.lock,
        operator: operator.operator,
        interactive: setup.interactive ?? true,
        wait: async ms => {
            waited += ms
            if (setup.goesAfterMs !== undefined && waited >= setup.goesAfterMs) {
                lock.die(HOLDER.pid)
            }
        },
    })
    return { lock, operator, takeOver: () => service("/repo", 4, HOLDER) }
}

describe("createTakeOverService: off a terminal", () => {
    it("should refuse, naming the holder", async () => {
        // given
        const { takeOver } = harness({ interactive: false })

        // when
        const result = await takeOver()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("afk process 7") })
    })

    it("should never offer the takeover", async () => {
        // given
        const { takeOver, operator } = harness({ interactive: false })

        // when
        await takeOver()

        // then
        expect(operator.offers).toEqual([])
    })
})

describe("createTakeOverService: on a terminal", () => {
    it("should offer the takeover, naming the spec and its holder", async () => {
        // given
        const { takeOver, operator } = harness({ takesOver: false })

        // when
        await takeOver()

        // then
        expect(operator.offers).toEqual([{ spec: 4, holder: HOLDER }])
    })

    it("should refuse, naming the holder, when the operator declines", async () => {
        // given
        const { takeOver } = harness({ takesOver: false })

        // when
        const result = await takeOver()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("afk process 7") })
    })

    it("should leave the holder alone when the operator declines", async () => {
        // given
        const { takeOver, lock } = harness({ takesOver: false })

        // when
        await takeOver()

        // then
        expect(await lock.lock.holder("/repo", 4)).toEqual(HOLDER)
    })

    it("should send the holder its own interrupt twice when the operator accepts", async () => {
        // given
        const { takeOver, lock } = harness()

        // when
        await takeOver()

        // then
        expect(lock.interrupted).toEqual([HOLDER, HOLDER])
    })

    it.each([
        ["one that goes on its interrupts", {}, undefined],
        ["one that takes a while to go", { unmoved: { 7: "interrupts" } }, 5_000],
        ["one that has to be killed", { unmoved: { 7: "interrupts" } }, undefined],
    ] as const)("should come back with the lock free, for %s", async (_, holder, goesAfterMs) => {
        // given
        const { takeOver } = harness({ holder, goesAfterMs })

        // when
        const result = await takeOver()

        // then
        expect(result).toEqual({ outcome: "freed" })
    })

    it("should not come back before a holder that takes a while has gone", async () => {
        // given
        const { takeOver, lock } = harness({ holder: { unmoved: { 7: "interrupts" } }, goesAfterMs: 5_000 })

        // when
        await takeOver()

        // then
        expect(await lock.lock.holder("/repo", 4)).toBeUndefined()
    })

    it.each([
        ["nobody, for a holder that goes on its interrupts", {}, undefined, []],
        ["nobody, for a holder that goes within the grace period", { unmoved: { 7: "interrupts" } }, 5_000, []],
        [
            "the holder, for one still there after the grace period",
            { unmoved: { 7: "interrupts" } },
            undefined,
            [HOLDER],
        ],
    ] as const)("should kill %s", async (_, holder, goesAfterMs, expected) => {
        // given
        const { takeOver, lock } = harness({ holder, goesAfterMs })

        // when
        await takeOver()

        // then
        expect(lock.killed).toEqual(expected)
    })

    it("should refuse, naming the holder, when even killing it did not free the lock", async () => {
        // given
        const { takeOver } = harness({ holder: { unmoved: { 7: "everything" } } })

        // when
        const result = await takeOver()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("afk process 7") })
    })
})
