import { describe, expect, it } from "vitest"
import type { Holder, RunLock } from "../../src/domain/lock.ts"

/**
 * The run lock's contract: one suite, written against the port and run twice — against the fake and
 * against the lock file in a temporary directory, with real processes behind the pids.
 */

/** A run directory to take locks on, and three processes to take them as. */
export type RunLockWorld = {
    lock: RunLock
    root: string
    spec: number
    /** The asking process, which is live. */
    self: Holder
    /** Another process that is live. */
    live: Holder
    /** A process that existed once and exists no longer. */
    dead: Holder
    /** A live process of this world's own, to be interrupted or killed. It goes on its interrupts. */
    doomed: Holder
}

/**
 * The lock's holder once it has settled. A signalled process is gone only once it has been reaped,
 * which is its parent's business and takes a moment.
 */
const settled = async (lock: RunLock, root: string, spec: number): Promise<Holder | undefined> => {
    for (let tries = 0; tries < 100; tries += 1) {
        const holder = await lock.holder(root, spec)
        if (holder === undefined) {
            return undefined
        }
        await new Promise(resolve => setTimeout(resolve, 20))
    }
    return lock.holder(root, spec)
}

export const describeRunLockContract = (name: string, create: () => Promise<RunLockWorld>): void => {
    describe(`${name}: acquire`, () => {
        it("should take a lock nobody holds", async () => {
            // given
            const { lock, root, spec, self } = await create()

            // when
            const acquired = await lock.acquire(root, spec, self)

            // then
            expect(acquired).toEqual({ ok: true })
        })

        it("should refuse a lock a live process holds, naming it", async () => {
            // given
            const { lock, root, spec, self, live } = await create()
            await lock.acquire(root, spec, live)

            // when
            const acquired = await lock.acquire(root, spec, self)

            // then
            expect(acquired).toEqual({ ok: false, holder: live })
        })

        it("should take a lock whose holder no longer exists", async () => {
            // given
            const { lock, root, spec, self, dead } = await create()
            await lock.acquire(root, spec, dead)

            // when
            const acquired = await lock.acquire(root, spec, self)

            // then
            expect(acquired).toEqual({ ok: true })
        })

        it("should give a holder asking again the lock it already has", async () => {
            // given
            const { lock, root, spec, self } = await create()
            await lock.acquire(root, spec, self)

            // when
            const acquired = await lock.acquire(root, spec, self)

            // then
            expect(acquired).toEqual({ ok: true })
        })

        it("should take one spec's lock whatever another spec's says", async () => {
            // given
            const { lock, root, spec, self, live } = await create()
            await lock.acquire(root, spec + 1, live)

            // when
            const acquired = await lock.acquire(root, spec, self)

            // then
            expect(acquired).toEqual({ ok: true })
        })
    })

    describe(`${name}: holder`, () => {
        it.each([
            ["nobody, where nothing was taken", "none", undefined],
            ["the process that took it", "live", "live"],
            ["nobody, where its holder no longer exists", "dead", undefined],
        ] as const)("should name %s", async (_, taker, expected) => {
            // given
            const world = await create()
            if (taker !== "none") {
                await world.lock.acquire(world.root, world.spec, world[taker])
            }

            // when
            const holder = await world.lock.holder(world.root, world.spec)

            // then
            expect(holder).toEqual(expected === undefined ? undefined : world[expected])
        })
    })

    describe(`${name}: interrupt and kill`, () => {
        it("should leave nobody holding the lock of a holder interrupted twice", async () => {
            // given
            const { lock, root, spec, doomed } = await create()
            await lock.acquire(root, spec, doomed)
            await lock.interrupt(doomed)
            await lock.interrupt(doomed)

            // when
            const holder = await settled(lock, root, spec)

            // then
            expect(holder).toBeUndefined()
        })

        it("should leave nobody holding the lock of a holder killed", async () => {
            // given
            const { lock, root, spec, doomed } = await create()
            await lock.acquire(root, spec, doomed)
            await lock.kill(doomed)

            // when
            const holder = await settled(lock, root, spec)

            // then
            expect(holder).toBeUndefined()
        })

        it.each(["interrupt", "kill"] as const)(
            "should %s a process that no longer exists without failing",
            async how => {
                // given
                const { lock, dead } = await create()

                // when
                const signalled = lock[how](dead)

                // then
                await expect(signalled).resolves.toBeUndefined()
            },
        )
    })

    describe(`${name}: release`, () => {
        it("should leave nobody holding a lock its holder released", async () => {
            // given
            const { lock, root, spec, self } = await create()
            await lock.acquire(root, spec, self)
            await lock.release(root, spec, self)

            // when
            const holder = await lock.holder(root, spec)

            // then
            expect(holder).toBeUndefined()
        })

        it("should leave a lock held when somebody other than its holder releases it", async () => {
            // given
            const { lock, root, spec, self, live } = await create()
            await lock.acquire(root, spec, live)
            await lock.release(root, spec, self)

            // when
            const holder = await lock.holder(root, spec)

            // then
            expect(holder).toEqual(live)
        })

        it("should let the next process take a released lock", async () => {
            // given
            const { lock, root, spec, self, live } = await create()
            await lock.acquire(root, spec, live)
            await lock.release(root, spec, live)

            // when
            const acquired = await lock.acquire(root, spec, self)

            // then
            expect(acquired).toEqual({ ok: true })
        })
    })
}
