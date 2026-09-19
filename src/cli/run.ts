import type { StartMode } from "../domain/mode.ts"
import type { ShowBoard } from "../service/board.ts"
import type { DriveRun } from "../service/drive.ts"
import type { FinishRun } from "../service/finish.ts"
import type { StartFresh } from "../service/fresh.ts"
import type { ReleaseRun } from "../service/release.ts"
import type { StartRun } from "../service/start.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import { freshOutput } from "./fresh-output.ts"
import type { Invocation } from "./invocation.ts"
import { planOutput } from "./plan-output.ts"
import { preparedOutput } from "./prepared-output.ts"
import { progressOutput } from "./progress-output.ts"
import { pullRequestOutput } from "./pull-request-output.ts"

export type RunDeps = {
    fresh: StartFresh
    /** The read-only view of a run, which is the whole of what `--board-only` does. */
    showBoard: ShowBoard
    start: StartRun
    drive: DriveRun
    finish: FinishRun
    /** Giving the run lock back, once whatever took it is over (ADR-0034). */
    release: ReleaseRun
    print: (line: string) => void
    printError: (line: string) => void
    /**
     * Whether the run's tickets were drawn one by one while it ran. Where they were, the bucket
     * summary is the same news a second time — the last frame already says per ticket what it says
     * per bucket — so it is left to the runs that had no board to draw on (ADR-0029).
     */
    boardDrawn: boolean
}

/**
 * The boundary between an accepted invocation and the use cases that serve it. It calls the use
 * cases an invocation names, turns what came back into lines and an exit code, and holds no rule
 * about a run. What order they are called in is the flag surface's, not a rule of its own: starting
 * over is what `--force-fresh` asks for before anything else, and a run stops at the first thing
 * that failed.
 *
 * A draft pull request is what a partial run comes to, and the exit code says the same thing in a
 * number: `0` is a ready pull request over a whole spec, `1` is a draft over part of one, and
 * anything else opened nothing. Success is never printed over a failure that happened, which is the
 * failure mode this whole rewrite exists to remove.
 */
export const createRun = ({
    fresh,
    showBoard,
    start,
    drive,
    finish,
    release,
    print,
    printError,
    boardDrawn,
}: RunDeps) => {
    /** Everything but the board, which is the one mode that takes no lock and so has none to give back. */
    const runLocked = async (invocation: Invocation & { mode: StartMode }): Promise<ExitCode> => {
        // Before anything is read, because what starting over throws away is what starting would
        // otherwise refuse over. A run that cannot be thrown away whole is not started on top of.
        if (invocation.forceFresh) {
            const cleared = await fresh(invocation.spec)
            if (cleared.outcome === "failed") {
                printError(`afk: ${cleared.reason}`)
                return EXIT.halted
            }
            for (const line of freshOutput(invocation.spec, cleared)) {
                print(line)
            }
        }

        const started = await start({
            spec: invocation.spec,
            mode: invocation.mode,
            consented: invocation.consented,
            base: invocation.base,
        })

        switch (started.outcome) {
            case "refused":
                printError(`afk: ${started.reason}`)
                return EXIT.halted

            case "aborted":
                printError("afk: the confirmation was closed, so nothing was started")
                return EXIT.halted

            case "planned":
                for (const line of planOutput(started.manifest, invocation.maxParallel)) {
                    print(line)
                }
                return EXIT.complete

            case "prepared": {
                for (const line of preparedOutput(started.run)) {
                    print(line)
                }

                const driven = await drive(started.run, { maxParallel: invocation.maxParallel })
                // An interrupted run is a partial one: it drained, so what follows is everything
                // that was in flight when the operator stopped it and nothing that came after. It
                // still opens its pull request, because a draft naming what is missing is what a
                // partial run is worth — and what did not land is the next start's work either way.
                if (driven.outcome === "interrupted") {
                    print("afk: the run was interrupted, so it stopped at what was already in flight")
                }
                if (!boardDrawn) {
                    for (const line of progressOutput(driven.progress)) {
                        print(line)
                    }
                }

                // A halted run opens nothing. It stopped itself because something is wrong with the
                // branch or the run rather than with a ticket, and a pull request over that is a
                // review of a question afk already knows the answer to.
                if (driven.outcome === "halted") {
                    printError(`afk: ${driven.reason}`)
                    return EXIT.halted
                }

                const finished = await finish(started.run, driven.progress)
                if (finished.outcome === "failed") {
                    printError(`afk: ${finished.reason}`)
                    return EXIT.halted
                }

                for (const line of pullRequestOutput(finished)) {
                    print(line)
                }
                return finished.draft ? EXIT.partial : EXIT.complete
            }
        }
    }

    return async (invocation: Invocation): Promise<ExitCode> => {
        // Before the first thing that could scroll them away: a flag that was accepted but will not
        // be acted on is news the operator needs while they can still stop and pass it differently.
        for (const warning of invocation.warnings) {
            printError(`afk: ${warning}`)
        }

        // Before the run directory is touched by anything, because it is never touched at all: the
        // viewer reads the manifest and the log and draws what they say (ADR-0030). Nor is the lock:
        // a second terminal watching a live run is not a second afk on it (ADR-0034). A spec that was
        // never planned is refused as a run that cannot start is, because the arguments were fine
        // and what is missing is on disk.
        const { mode } = invocation
        if (mode === "board-only") {
            const drawn = await showBoard(invocation.spec)
            if (drawn.outcome === "refused") {
                printError(`afk: ${drawn.reason}`)
                return EXIT.halted
            }
            return drawn.whole ? EXIT.complete : EXIT.partial
        }

        try {
            return await runLocked({ ...invocation, mode })
        } finally {
            await release(invocation.spec)
        }
    }
}
