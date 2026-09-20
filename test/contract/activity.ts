import { describe, expect, it } from "vitest"
import type { Activity } from "../../src/domain/activity.ts"

/**
 * The activity port's contract: one suite, written against the port and run twice — against the
 * fake and against the run directory on disk. It covers reading the last write of a file that is
 * being appended to, which is the one thing the board asks of it.
 */

/** What a step writes: an agent's transcript, or the log of the operator's own commands. */
export const WRITERS = ["transcript", "command"] as const

export type Writer = (typeof WRITERS)[number]

/** A run directory to run the contract against: the port, and what a step would write into it. */
export type ActivityWorld = {
    activity: Activity
    root: string
    /** Append a record stamped `at` to the file at `path`, as a step of this kind writes one. */
    write: (path: string, writer: Writer, at: Date) => Promise<void>
    /** Append a record that carries no instant, as an agent's own bookkeeping does. */
    unstamped: (path: string) => Promise<void>
}

const at = (minute: number): Date => new Date(`2026-01-01T10:${`${minute}`.padStart(2, "0")}:00.000Z`)

const LATER = at(59)

export const describeActivityContract = (name: string, create: () => Promise<ActivityWorld>): void => {
    describe(`${name}: lastWrite`, () => {
        it("should be nothing for a step that has written nothing yet", async () => {
            // given
            const world = await create()

            // when
            const written = await world.activity.lastWrite(world.root, "transcripts/t7.jsonl", LATER)

            // then
            expect(written).toBeUndefined()
        })

        it.each(WRITERS)("should be the latest record of a %s", async writer => {
            // given
            const world = await create()
            await world.write("out/t7", writer, at(1))
            await world.write("out/t7", writer, at(3))

            // when
            const written = await world.activity.lastWrite(world.root, "out/t7", LATER)

            // then
            expect(written).toEqual(at(3))
        })

        it.each(WRITERS)("should see a %s record appended after the last ask", async writer => {
            // given
            const world = await create()
            await world.write("out/t7", writer, at(1))
            await world.activity.lastWrite(world.root, "out/t7", LATER)
            await world.write("out/t7", writer, at(4))

            // when
            const written = await world.activity.lastWrite(world.root, "out/t7", LATER)

            // then
            expect(written).toEqual(at(4))
        })

        it.each(WRITERS)("should not count a %s record written after the instant asked about", async writer => {
            // given
            const world = await create()
            await world.write("out/t7", writer, at(1))
            await world.write("out/t7", writer, at(5))

            // when
            const written = await world.activity.lastWrite(world.root, "out/t7", at(2))

            // then
            expect(written).toEqual(at(1))
        })

        it("should not count a record that carries no instant", async () => {
            // given
            const world = await create()
            await world.write("out/t7", "transcript", at(1))
            await world.unstamped("out/t7")

            // when
            const written = await world.activity.lastWrite(world.root, "out/t7", LATER)

            // then
            expect(written).toEqual(at(1))
        })

        it("should answer for the file asked about and no other", async () => {
            // given
            const world = await create()
            await world.write("out/t7", "command", at(1))
            await world.write("out/t8", "command", at(6))

            // when
            const written = await world.activity.lastWrite(world.root, "out/t7", LATER)

            // then
            expect(written).toEqual(at(1))
        })
    })
}
