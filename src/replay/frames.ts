import { type BoardView, boardOf } from "../domain/board.ts"
import type { Action } from "../domain/decide.ts"
import { attempts, brokenStep, type LifecycleEvent, repairableStep, type Step, statusOf } from "../domain/events.ts"
import type { Manifest } from "../domain/manifest.ts"

/**
 * Replaying an event log as the board it was, and the pure half of it: one view per line of the
 * log, and the wait between two of them.
 *
 * The board is a pure function of three inputs and the log is only two of them (ADR-0029). The
 * third — the driver's live action set — is the one thing a log can never carry, because liveness
 * is not recordable: a `running` event says a step began, and only the process that began it can
 * say whether it is still happening (ADR-0019).
 *
 * So a replay reconstructs it, the only way a log allows: at any point in the log, a step whose
 * start event is its ticket's last word was running *then*, because the process that wrote that
 * line was alive to write it. That is true of every prefix but one — the whole log — and that is
 * the exception the closing frame exists for.
 */

/** One drawn moment of the replay: the view, and what the log says it is about. */
export type ReplayFrame = {
    view: BoardView
    /** The event the frame is about, and nothing for the two frames no event produced. */
    event: LifecycleEvent | undefined
    /** When that event was appended, where it carried an instant a clock can read. */
    at: Date | undefined
}

/** How fast a replay goes: a wait of its own, or the log's own clock divided down. */
export type Pacing =
    /** The same wait between every pair of frames, whatever the run took. */
    | { kind: "fixed"; ms: number }
    /**
     * The gaps the run actually had, divided by a factor — `60` is a minute of the run per second
     * of the replay. A factor at or below zero is no wait at all, so `--speed 0` is "as fast as it
     * reads".
     */
    | { kind: "real"; factor: number }

/**
 * The instant an event carries, where it carries one a clock can read. `at` is never branched on by
 * the domain and is therefore never validated past being a non-empty string, so a replay that paces
 * itself by it treats an unreadable one as no instant rather than as time zero.
 */
const instantOf = (event: LifecycleEvent): Date | undefined => {
    const at = new Date(event.at)
    return Number.isNaN(at.getTime()) ? undefined : at
}

/**
 * The action the driver held while this step was running, rebuilt from the log the step is read
 * out of. The kind is the step — that is what `stepOf` reads back off it — and the fields beside it
 * are counted the same way the decision function counts them, so that a rebuilt action is one the
 * driver could have been holding rather than one shaped like it.
 *
 * A prepare pass is the one that can come back empty: it is read at the step it was sent to repair,
 * and a pass over a log with no repairable step behind it is a log that disagrees with itself. The
 * ticket is then simply not busy, which is what it looks like anyway.
 *
 * `plan` and `pull-request` are about the run rather than about a ticket (ADR-0028), and no action
 * of the driver's names them.
 */
const actionOf = (events: readonly LifecycleEvent[], ticket: number, step: Step): Action | undefined => {
    switch (step) {
        case "setup":
            return { kind: "setup", ticket }
        case "implement":
            return { kind: "implement", ticket, attempt: attempts(events, ticket, "implement") }
        case "prepare": {
            const broke = brokenStep(events, ticket)
            return broke !== undefined && repairableStep(broke)
                ? { kind: "prepare", ticket, brokenStep: broke }
                : undefined
        }
        case "rebase":
            return { kind: "rebase", ticket }
        // A resolve spends the rebase's budget rather than one of its own, so it is counted off the
        // rebase start events exactly as the decision function counts it.
        case "resolve":
            return { kind: "resolve", ticket, attempt: attempts(events, ticket, "rebase") }
        case "merge":
            return { kind: "merge", ticket }
        case "gate":
            return { kind: "gate", ticket }
        case "fix":
            return { kind: "fix", ticket }
        case "revert":
            return { kind: "revert", ticket }
        case "plan":
        case "pull-request":
            return undefined
    }
}

/**
 * The live action set as of this much of the log: one action per ticket whose last event says a
 * step began and nothing has ended it.
 *
 * Read per ticket rather than over the whole log because that is what "still running" means here —
 * a start event some later event of the same ticket answered is a step that ended, and one nothing
 * answered is a step that was going when the line after it was written.
 */
export const liveActions = (manifest: Manifest, events: readonly LifecycleEvent[]): readonly Action[] =>
    manifest.tickets.flatMap((ticket): Action[] => {
        const last = statusOf(events, ticket.number)
        if (last === undefined || last.outcome !== "running") {
            return []
        }
        const action = actionOf(events, ticket.number, last.step)
        return action === undefined ? [] : [action]
    })

/**
 * Every frame a log is, in order: the empty board the run opened on, one frame per line, and the
 * board the next process would open on.
 *
 * The opening frame is what makes the replay a run rather than a summary — off a terminal the first
 * view is the baseline and news for nothing, so starting anywhere else would swallow whatever had
 * already happened by then.
 *
 * The closing frame is the whole log's board, held once more with no event beside it: the replay
 * ends on what a resume would open on rather than on the last line's own news.
 */
export const replayFrames = (manifest: Manifest, events: readonly LifecycleEvent[]): readonly ReplayFrame[] => [
    { view: boardOf(manifest, []), event: undefined, at: undefined },
    // Each frame derives from the whole prefix rather than from the one before it, because that is
    // what the board is: a function of the log, never of the last thing drawn (ADR-0030).
    ...events.map((event, index): ReplayFrame => {
        const soFar = events.slice(0, index + 1)
        return { view: boardOf(manifest, soFar), event, at: instantOf(event) }
    }),
    { view: boardOf(manifest, events), event: undefined, at: undefined },
]

/**
 * How long to hold the frame before this one. Nothing before the first, and nothing across a frame
 * the log gave no instant for: the two frames no event produced are the run's own edges, and a wait
 * against them would be invented rather than replayed.
 */
export const waitBefore = (pacing: Pacing, previous: ReplayFrame | undefined, frame: ReplayFrame): number => {
    if (previous === undefined) {
        return 0
    }
    if (pacing.kind === "fixed") {
        return Math.max(0, pacing.ms)
    }
    if (previous.at === undefined || frame.at === undefined || pacing.factor <= 0) {
        return 0
    }
    // A log is appended to in order, but it is a file on disk and a clock that went backwards is a
    // machine's business rather than a replay's: the gap is never negative.
    return Math.max(0, (frame.at.getTime() - previous.at.getTime()) / pacing.factor)
}
