import type { Activity } from "../domain/activity.ts"
import { type Board, boardOf, writers } from "../domain/board.ts"
import type { Clock, Ticker } from "../domain/clock.ts"
import type { EventLog, LifecycleEvent } from "../domain/events.ts"
import type { Manifest } from "../domain/manifest.ts"

/** How often the board is redrawn while nothing settles: often enough that an elapsed figure counts. */
export const TICK_MS = 1000

/** The run whose board is watched: where its run directory is, and the tickets its rows are. */
export type WatchTarget = { root: string; spec: number; manifest: Manifest }

export type WatchOptions = {
    /**
     * A log the watch has seen enough of: once one satisfies it, the frame drawn for it is the last.
     * The viewer's "the run concluded".
     */
    until?: (log: readonly LifecycleEvent[]) => boolean
    /**
     * Stops the watch from outside — the runner's "the drive is over". The log is read once more and
     * drawn, so that the frame left on screen is what the run came to rather than whatever the
     * last look happened to catch.
     */
    signal?: AbortSignal
}

/**
 * The driving port of redrawing a run's board: draw it until told to stop, and give back the last
 * log a frame was drawn from.
 */
export type WatchBoard = (target: WatchTarget, options?: WatchOptions) => Promise<readonly LifecycleEvent[]>

export type WatchBoardDeps = {
    /** When each running step last wrote, which is what says whether it has gone quiet. */
    activity: Activity
    /** Where each frame is shown (ADR-0029). */
    board: Board
    events: EventLog
    /** The instant each view is derived at, which is what a row's elapsed figure counts to. */
    now: Clock
    /** What wakes the watch while the log stands still. */
    ticker: Ticker
}

type Woke =
    | { from: "log"; next: IteratorResult<readonly LifecycleEvent[]> }
    | { from: "tick"; next: IteratorResult<void> }

/**
 * The one owner of redrawing, which the runner and the viewer both drive through, so that two
 * terminals showing one run redraw on the same terms and never disagree.
 *
 * It wakes on a change to the log and on a tick, and on either it derives the view from the run
 * directory and the instant afresh and draws it. The tick is what keeps a run that is thinking from
 * looking like a run that has stopped: a step can go a minute without settling, and a frame drawn
 * only when something settles is a minute old by then.
 *
 * A tick is a redraw and nothing else. Nothing is appended for it: the log stays a record of what
 * was attempted (ADR-0011).
 */
export const createWatchBoardService =
    ({ activity, board, events, now, ticker }: WatchBoardDeps): WatchBoard =>
    async ({ root, spec, manifest }, { until = () => false, signal } = {}) => {
        // One abort stops both sources, whether the caller asked or the log said enough.
        const stopping = new AbortController()
        const stop = (): void => stopping.abort()
        if (signal?.aborted === true) {
            stop()
        }
        signal?.addEventListener("abort", stop, { once: true })

        // A tick re-reads the writes too: a step goes quiet by writing nothing, so no change to the
        // log ever says so.
        const draw = async (log: readonly LifecycleEvent[]): Promise<void> => {
            const at = now()
            const writes = new Map(
                await Promise.all(
                    writers(manifest, log).map(async path => [path, await activity.lastWrite(root, path, at)] as const),
                ),
            )
            board.show(boardOf(manifest, log, at, writes))
        }

        const logs = events.follow(root, spec, stopping.signal)[Symbol.asyncIterator]()
        const nextLog = (): Promise<Woke> => logs.next().then(next => ({ from: "log", next }))
        let awaitingLog: Promise<Woke> | undefined = nextLog()
        // Ticking starts once there is a log to draw: a tick before the first frame has nothing
        // to redraw.
        let ticks: AsyncIterator<void> | undefined
        let awaitingTick: Promise<Woke> | undefined
        const nextTick = (beating: AsyncIterator<void>): Promise<Woke> =>
            beating.next().then(next => ({ from: "tick", next }))
        let last: readonly LifecycleEvent[] = []

        while (awaitingLog !== undefined || awaitingTick !== undefined) {
            const woke = await Promise.race([awaitingLog, awaitingTick].filter(awaiting => awaiting !== undefined))

            if (woke.from === "log") {
                if (woke.next.done === true) {
                    awaitingLog = undefined
                    continue
                }
                last = woke.next.value
                await draw(last)
                if (until(last)) {
                    break
                }
                awaitingLog = nextLog()
                if (ticks === undefined) {
                    ticks = ticker(TICK_MS, stopping.signal)[Symbol.asyncIterator]()
                    awaitingTick = nextTick(ticks)
                }
                continue
            }

            if (woke.next.done === true || ticks === undefined) {
                awaitingTick = undefined
                continue
            }
            await draw(last)
            awaitingTick = nextTick(ticks)
        }

        stop()
        signal?.removeEventListener("abort", stop)

        if (signal?.aborted === true) {
            last = await events.read(root, spec)
            await draw(last)
        }
        return last
    }
