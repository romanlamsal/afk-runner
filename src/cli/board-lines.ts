import type { BoardRow, BoardView, SettledOutcome } from "../domain/board.ts"
import type { Step } from "../domain/events.ts"

/**
 * The board off a terminal: a pure mapping from two consecutive views to the lines that the second
 * one is news for. It is the `jq` pipeline an operator writes over `events.jsonl` by hand, built in
 * — one plain line per change, with nothing redrawn and nothing to redraw it on.
 *
 * A step a previous process left running is said once, on the first view that is news for anything:
 * the baseline it arrives on is news for nothing, and a repair pass reopening it says it again as it
 * begins.
 *
 * It is lossless at step granularity because the driver shows a view on every pass and every settled
 * action ends one: a step that began and a step that ended are two views apart, so neither can be
 * read over by the other.
 *
 * The first view is the baseline and is news for nothing. A resumed run would otherwise open by
 * replaying a previous process's log as though it had just happened.
 */

/** What a change to a row is: a step of it, and what that step began or came to. */
type Change = { step: Step; outcome: SettledOutcome | "running" }

const changes = (before: BoardRow, after: BoardRow): readonly Change[] => {
    const was = new Map(before.steps.map(entry => [entry.step, entry]))

    return after.steps.flatMap((entry): readonly Change[] => {
        const previous = was.get(entry.step)
        switch (entry.state) {
            case "running":
                return previous?.state === "running" ? [] : [{ step: entry.step, outcome: "running" }]
            case "settled":
                return previous?.state === "settled" && previous.outcome === entry.outcome
                    ? []
                    : [{ step: entry.step, outcome: entry.outcome }]
            case "ahead":
                // A step going back to ahead is a track change taking its trail with it, and the
                // steps it left behind were already said when they settled.
                return []
        }
    })
}

/** A step that did not simply work, which is the only kind a reason is ever written about. */
const unhappy = (change: Change): boolean => change.outcome !== "ok" && change.outcome !== "running"

const written = (ticket: number, change: Change, detail: string | undefined): string =>
    `#${ticket} ${change.step} ${change.outcome}${detail === undefined ? "" : `: ${detail}`}`

/**
 * One row's lines. The row's reason goes on the last step of them that did not simply work, which
 * is the step the log settled it about: a green step needs no explanation and would only be made
 * longer by one.
 */
const lines = (before: BoardRow, after: BoardRow): string[] => {
    const changed = changes(before, after)
    const explained = changed.findLastIndex(unhappy)

    return changed.map((change, index) => written(after.ticket, change, index === explained ? after.detail : undefined))
}

export const boardLines = (before: BoardView | undefined, after: BoardView): string[] => {
    if (before === undefined) {
        return []
    }

    return after.rows.flatMap(row => {
        const previous = before.rows.find(candidate => candidate.ticket === row.ticket)
        return previous === undefined ? [] : lines(previous, row)
    })
}
