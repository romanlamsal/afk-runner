import { describe, expect, it } from "vitest"
import type { Board, BoardView } from "../../src/domain/board.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import { createWatchBoardService } from "../../src/service/watch.ts"
import { createFakeActivity, type FakeActivity } from "../fakes/activity.ts"
import { createFakeBoard } from "../fakes/board.ts"
import { createFakeEventLog, type FakeEventLog } from "../fakes/event-log.ts"
import { createFakeRunLock, type FakeRunLock } from "../fakes/run-lock.ts"
import { createFakeTicker } from "../fakes/ticker.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The one owner of redrawing. What a view says is the board's own suite; what is asserted here is
 * when the watch draws one — on a change to the log, on a tick, and once more when it is stopped —
 * and that drawing writes nothing.
 */
const MANIFEST = manifestOf([ticket(5)])

const TARGET = { root: "/repo", spec: 4, manifest: MANIFEST }

/** The afk process holding the run, which is what makes its open steps steps that are happening. */
const HOLDER = { pid: 4242 }

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
    held = true,
    board = createFakeBoard().board,
    activity = createFakeActivity(),
}: {
    log?: readonly LifecycleEvent[]
    changes?: readonly (readonly LifecycleEvent[])[]
    beats?: number
    /** Whether a live afk holds the run the watch is drawing. */
    held?: boolean
    board?: Board
    activity?: FakeActivity
} = {}) => {
    const events = createFakeEventLog(log, { changes })
    const lock = createFakeRunLock(held ? { heldBy: HOLDER } : {})
    const watch = createWatchBoardService({
        activity: activity.activity,
        board,
        events: events.log,
        lock: lock.lock,
        now: advancing(),
        ticker: createFakeTicker(beats),
    })
    return { watch, events, lock }
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

    it.each([
        ["still writing", ["2026-01-01T10:00:00.000Z"], false],
        ["written nothing since it started", [], true],
    ] as const)("should draw a step running for ten minutes that has %s", async (_case, writes, quiet) => {
        // given
        const board = createFakeBoard()
        const activity = createFakeActivity()
        const transcript = ".afk/4/transcripts/t5-implement-1.jsonl"
        for (const write of writes) {
            activity.write(transcript, new Date(write))
        }
        const started: LifecycleEvent = {
            ...event("running", 0),
            at: "2026-01-01T09:50:00.000Z",
            transcriptPath: transcript,
        }
        const { watch } = harness({ board: board.board, activity, log: [started], beats: 1 })

        // when
        await watch(TARGET)

        // then
        expect(board.shown.map(view => view.rows[0]?.quiet)).toEqual([quiet, quiet])
    })

    it.each([
        ["running", "somebody holds the run", true],
        ["interrupted", "nothing holds the run", false],
    ] as const)("should draw a step the log left running as %s where %s", async (state, _case, held) => {
        // given
        const board = createFakeBoard()
        const { watch } = harness({ board: board.board, held, log: [event("running", 0)] })

        // when
        await watch(TARGET)

        // then
        expect(board.shown[0]?.rows[0]?.steps.find(entry => entry.step === "implement")?.state).toBe(state)
    })

    it("should draw the run as dead from the tick after its holder went", async () => {
        // given: a run whose holder dies while the first frame of it is on screen
        const shown: BoardView[] = []
        let holding: FakeRunLock | undefined
        const board: Board = {
            show: view => {
                shown.push(view)
                holding?.die(HOLDER.pid)
            },
            notice: () => undefined,
        }
        const run = harness({ board, log: [event("running", 0)], beats: 1 })
        holding = run.lock

        // when
        await run.watch(TARGET)

        // then
        expect(shown.map(view => view.rows[0]?.steps.find(entry => entry.step === "implement")?.state)).toEqual([
            "running",
            "interrupted",
        ])
    })

    it("should take no lock of its own, because watching a run costs that run nothing", async () => {
        // given
        const { watch, lock } = harness({ log: [event("running", 0)] })

        // when
        await watch(TARGET)

        // then
        expect([...lock.held.values()]).toEqual([HOLDER])
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
