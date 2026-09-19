import { createLineBoard, createTerminalBoard } from "./cli/board-writer.ts"
import { type Cli, createCli } from "./cli/cli.ts"
import { EXIT } from "./cli/exit-codes.ts"
import { createTerminalOperator } from "./cli/operator.ts"
import { createRun } from "./cli/run.ts"
import { createClaudeAgentRunner } from "./infrastructure/claude-agent-runner.ts"
import { createShellCommandRunner } from "./infrastructure/commands.ts"
import { createEnvironmentFiles } from "./infrastructure/environment-files.ts"
import { createGit } from "./infrastructure/git.ts"
import { createSignalInterrupts } from "./infrastructure/interrupts.ts"
import { killEveryChild } from "./infrastructure/process.ts"
import { createIntervalTicker } from "./infrastructure/ticker.ts"
import { createGitHubTracker } from "./infrastructure/tracker.ts"
import { createFileActivity } from "./repository/activity.ts"
import { createFileEventLog } from "./repository/event-log.ts"
import { createFileManifestStore } from "./repository/manifest-store.ts"
import { createFileRunLock } from "./repository/run-lock.ts"
import { createFileRunRecordStore } from "./repository/run-records.ts"
import { createShowBoardService } from "./service/board.ts"
import { createDriveService } from "./service/drive.ts"
import { createFinishService } from "./service/finish.ts"
import { createFixService } from "./service/fix.ts"
import { createFreshService } from "./service/fresh.ts"
import { createGateService, createProveBranch } from "./service/gate.ts"
import { createImplementService } from "./service/implement.ts"
import { createMergeService } from "./service/merge.ts"
import { createPlanService } from "./service/plan.ts"
import { createPrepareService } from "./service/prepare.ts"
import { createRebaseService } from "./service/rebase.ts"
import { createReleaseService } from "./service/release.ts"
import { createResolveService } from "./service/resolve.ts"
import { createRevertService } from "./service/revert.ts"
import { createSetupService } from "./service/setup.ts"
import { createStartService } from "./service/start.ts"
import { createWatchBoardService } from "./service/watch.ts"

/**
 * Assembly is not a layer. It is the only module that knows both a port and its implementation:
 * it builds the adapters, calls the factories, and hands the result to the cli.
 */
export const assembleCli = (): Cli => {
    const printError = (line: string): void => {
        process.stderr.write(`${line}\n`)
    }
    const print = (line: string): void => {
        process.stdout.write(`${line}\n`)
    }

    const manifests = createFileManifestStore()
    const records = createFileRunRecordStore()
    const agent = createClaudeAgentRunner()
    const commands = createShellCommandRunner()
    const environment = createEnvironmentFiles()
    const events = createFileEventLog()
    const git = createGit()
    // One afk per spec, and this process is the one the lock names while it holds it (ADR-0034).
    const lock = createFileRunLock()
    const self = { pid: process.pid }
    // Selection is TTY detection and there is no flag: the board is simply what a run looks like,
    // redrawn where there is a terminal to draw it on and a line per change where there is not
    // (ADR-0029).
    const drawing = process.stdout.isTTY === true
    const board = drawing
        ? createTerminalBoard({
              write: chunk => process.stdout.write(chunk),
              columns: () => process.stdout.columns ?? 80,
          })
        : createLineBoard({ print })

    // Registered once for the whole process, which is the point: no step traps the signal, and the
    // loop reads a flag (ADR-0016). A termination request is the same request, so it drains too.
    const interrupts = createSignalInterrupts({
        listen: handler => {
            process.on("SIGINT", handler)
            process.on("SIGTERM", handler)
        },
        kill: () => {
            killEveryChild()
            process.exit(EXIT.interrupted)
        },
        // The drain notice goes through whoever owns the terminal. On one that is the board, which
        // draws it as a status line instead of letting it land in the middle of a frame; off one
        // the board draws nothing and stderr is still where it belongs (ADR-0029).
        notifyDraining: drawing ? board.notice : printError,
        notifyKilled: printError,
    })
    const now = (): Date => new Date()
    // Both writes a whole run makes to GitHub go through it: the claim, and the spec pull request
    // at the end (ADR-0013).
    const tracker = createGitHubTracker()

    // Where afk was invoked. The target repository is this directory's git top level, which the
    // services resolve — nothing here assumes the two are the same.
    const cwd = process.cwd()

    const start = createStartService({
        cwd,
        environment,
        events,
        git,
        lock,
        self,
        manifests,
        operator: createTerminalOperator({ input: process.stdin, output: process.stdout, print }),
        plan: createPlanService({ agent, events, git, manifests, now }),
        records,
    })

    // Asked twice, for different reasons: by the gate, about a ticket, and by the revert, about the
    // branch that ticket was taken back off (ADR-0009).
    const prove = createProveBranch({ commands })

    // The one thing that redraws the board, handed to the runner and the viewer alike so that both
    // redraw on the same terms: a change to the log, and a tick while nothing settles. It reads when
    // each running step last wrote off the run directory, so both draw the same colour for the same
    // step (ADR-0034).
    const watch = createWatchBoardService({
        activity: createFileActivity(),
        board,
        events,
        now,
        ticker: createIntervalTicker(),
    })

    const drive = createDriveService({
        events,
        interrupts,
        implement: createImplementService({ agent, events, git, now }),
        setup: createSetupService({ commands, environment, events, git, now, tracker }),
        rebase: createRebaseService({ events, git, now }),
        resolve: createResolveService({ agent, events, git, now }),
        merge: createMergeService({ events, git, now }),
        gate: createGateService({ events, git, now, prove }),
        fix: createFixService({ agent, events, git, now }),
        revert: createRevertService({ events, git, now, prove }),
        prepare: createPrepareService({ agent, events, git, now }),
        now,
        watch,
    })

    return createCli({
        isInteractive: () => process.stdin.isTTY === true,
        printError,
        run: createRun({
            fresh: createFreshService({ cwd, git, lock, self, records, tracker }),
            showBoard: createShowBoardService({ cwd, git, manifests, watch }),
            start,
            drive,
            finish: createFinishService({ agent, events, git, now, tracker }),
            release: createReleaseService({ cwd, git, lock, self }),
            print,
            printError,
            boardDrawn: drawing,
        }),
    })
}
