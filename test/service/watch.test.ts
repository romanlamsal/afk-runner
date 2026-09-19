import { describe, expect, it } from "vitest"
import type { Board, BoardView } from "../../src/domain/board.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import { createWatchBoardService } from "../../src/service/watch.ts"
import { createFakeBoard } from "../fakes/board.ts"
import { createFakeEventLog, type FakeEventLog } from "../fakes/event-log.ts"
import { createFakeTicker } from "../fakes/ticker.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The one owner of redrawing. What a view says is the board's own suite; what is asserted here is
 * when the watch draws one — on a change to the log, on a tick, and once more when it is stopped —
 * and that drawing writes nothing.
 */
const MANIFEST = manifestOf([ticket(5)])

const TARGET = { root: "/repo", spec: 4, manifest: MANIFEST }

const at = (second: number): string => `2026-01-01T10:00:0${second}.000Z`

const event = (outcome: LifecycleEvent["outcome"], second: number): LifecycleEvent => ({
    ticket: 5,
    step: "implement",
    outcome,
    at: at(second),
})

/** A clock that moves on a second every time it is read, starting a second after the log began. */
const advancing = () => {
    let second = 0
    return () => {
        second += 1
        return new Date(at(second))
    }
}

const harness = ({
    log = [],
    changes = [],
    beats = 0,
    board = createFakeBoard().board,
}: {
    log?: readonly LifecycleEvent[]
    changes?: readonly (readonly LifecycleEvent[])[]
    beats?: number
    board?: Board
} = {}) => {
    const events = createFakeEventLog(log, { changes })
    const watch = createWatchBoardService({
        board,
        events: events.log,
        now: advancing(),
        ticker: createFakeTicker(beats),
    })
    return { watch, events }
}

describe("createWatchBoardService", () => {
    it("should draw the log as it stands and again on each change to it", async () => {
        // given
        const board = createFakeBoard()
        const { watch } = harness({
            board: board.board,
            changes: [[event("running", 0)], [event("ok", 1)]],
        })

        // when
        await watch(TARGET)

        // then
        expect(board.shown.map(view => view.at)).toEqual([undefined, at(0), at(1)])
    })

    it("should redraw on every tick while nothing settles", async () => {
        // given
        const board = createFakeBoard()
        const { watch } = harness({ board: board.board, log: [event("running", 0)], beats: 2 })

        // when
        await watch(TARGET)

        // then
        expect(board.shown).toHaveLength(3)
    })

    it("should derive each tick's frame at the instant it is drawn", async () => {
        // given
        const board = createFakeBoard()
        const { watch } = harness({ board: board.board, log: [event("running", 0)], beats: 2 })

        // when
        await watch(TARGET)

        // then
        expect(board.shown.map(view => view.rows[0]?.elapsed)).toEqual([1000, 2000, 3000])
    })

    it("should append nothing to the log on a tick", async () => {
        // given
        const { watch, events } = harness({ log: [event("running", 0)], beats: 3 })

        // when
        await watch(TARGET)

        // then
        expect(events.appended).toEqual([event("running", 0)])
    })

    it("should stop at the frame whose log it was told was enough", async () => {
        // given
        const board = createFakeBoard()
        const { watch } = harness({
            board: board.board,
            log: [event("running", 0)],
            changes: [[event("ok", 1)], [event("running", 2)]],
            beats: 3,
        })

        // when
        await watch(TARGET, { until: log => log.some(logged => logged.outcome === "ok") })

        // then
        expect(board.shown.map(view => view.at)).toEqual([at(0), at(1)])
    })

    it("should give back the last log it drew", async () => {
        // given
        const { watch } = harness({ changes: [[event("running", 0)]] })

        // when
        const last = await watch(TARGET)

        // then
        expect(last).toEqual([event("running", 0)])
    })

    it("should draw the log as it stands once it is stopped from outside", async () => {
        // given: a run that settles its step and is then over, while the watch would tick forever
        const stopping = new AbortController()
        const shown: BoardView[] = []
        let events: FakeEventLog | undefined
        const board: Board = {
            show: view => {
                shown.push(view)
                if (shown.length === 1) {
                    void events?.log.append(TARGET.root, TARGET.spec, event("ok", 1))
                    stopping.abort()
                }
            },
            notice: () => undefined,
        }
        const run = harness({ board, log: [event("running", 0)], beats: Number.POSITIVE_INFINITY })
        events = run.events

        // when
        await run.watch(TARGET, { signal: stopping.signal })

        // then
        expect(shown.at(-1)?.at).toEqual(at(1))
    })
})
