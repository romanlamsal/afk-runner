import { type Board, boardOf } from "../domain/board.ts"
import { type EventLog, progressOf } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import type { ManifestStore } from "../domain/manifest.ts"
import { wholeSpec } from "../domain/pull-request.ts"

/**
 * What showing a run's board came to. `shown` carries what the log says the run came to, so that
 * the process can exit with the run's own verdict without anything reading the log a second time.
 */
export type ShowBoardResult =
    | {
          outcome: "shown"
          /**
           * Every ticket of the manifest verified — the same question the pull request asks of the
           * same progress classification, so a viewer can never disagree with the runner about
           * whether a spec landed (`layers.md`, question 3).
           */
          whole: boolean
      }
    | { outcome: "refused"; reason: string }

/** The driving port of `--board-only`: draw what the run directory says about this spec. */
export type ShowBoard = (spec: number) => Promise<ShowBoardResult>

export type ShowBoardDeps = {
    /** Where the view is shown. The same driven port the runner draws through (ADR-0029). */
    board: Board
    /** Where afk was invoked. The run directory is this directory's git top level. */
    cwd: string
    events: EventLog
    git: Git
    manifests: ManifestStore
}

/**
 * The viewer: the manifest and the event log, read once, turned into the view the runner draws and
 * handed to the board.
 *
 * It writes nothing — no run directory, no event, no branch — which is what lets it be pointed at a
 * run in flight without disturbing it, and what makes a second viewer cost that run nothing
 * (ADR-0030). It is a service rather than something the cli does for itself because every read afk
 * makes is service-side: the cli is handed built data.
 */
export const createShowBoardService =
    ({ board, cwd, events, git, manifests }: ShowBoardDeps): ShowBoard =>
    async spec => {
        const root = await git.topLevel(cwd)
        if (root === undefined) {
            return {
                outcome: "refused",
                reason: "this is not a git worktree: run afk from inside the repository whose spec this is",
            }
        }

        // The row set and the frame's height are the manifest's tickets, so a spec with no manifest
        // has no board rather than an empty one (ADR-0030).
        const stored = await manifests.read(root, spec)
        if (stored === undefined) {
            return { outcome: "refused", reason: `spec #${spec} has not been planned, so there is no board to draw` }
        }
        if (!stored.ok) {
            return { outcome: "refused", reason: stored.reason }
        }
        const manifest = stored.manifest

        const log = await events.read(root, spec)
        board.show(boardOf(manifest, log))

        const tickets = manifest.tickets.map(ticket => ticket.number)
        return { outcome: "shown", whole: wholeSpec(tickets, progressOf(tickets, log)) }
    }
