import { type Cli, createCli } from "./cli/cli.ts"
import { createTerminalOperator } from "./cli/operator.ts"
import { createRun } from "./cli/run.ts"
import { createClaudeAgentRunner } from "./infrastructure/claude-agent-runner.ts"
import { createShellCommandRunner } from "./infrastructure/commands.ts"
import { createEnvironmentFiles } from "./infrastructure/environment-files.ts"
import { createGit } from "./infrastructure/git.ts"
import { createGitHubTracker } from "./infrastructure/tracker.ts"
import { createFileEventLog } from "./repository/event-log.ts"
import { createFileManifestStore } from "./repository/manifest-store.ts"
import { createFileRunRecordStore } from "./repository/run-records.ts"
import { createDriveService } from "./service/drive.ts"
import { createImplementService } from "./service/implement.ts"
import { createMergeService } from "./service/merge.ts"
import { createPlanService } from "./service/plan.ts"
import { createStartService } from "./service/start.ts"

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
    const agent = createClaudeAgentRunner()
    const environment = createEnvironmentFiles()
    const events = createFileEventLog()
    const git = createGit()
    const now = (): Date => new Date()

    const start = createStartService({
        // Where afk was invoked. The target repository is this directory's git top level, which the
        // start service resolves — nothing here assumes the two are the same.
        cwd: process.cwd(),
        environment,
        git,
        manifests,
        operator: createTerminalOperator({ input: process.stdin, output: process.stdout, print }),
        plan: createPlanService({ agent, manifests, now }),
        records: createFileRunRecordStore(),
    })

    const drive = createDriveService({
        events,
        implement: createImplementService({
            agent,
            commands: createShellCommandRunner(),
            environment,
            events,
            git,
            now,
            tracker: createGitHubTracker(),
        }),
        merge: createMergeService({ agent, events, git, now }),
        now,
    })

    return createCli({
        isInteractive: () => process.stdin.isTTY === true,
        printError,
        run: createRun({ start, drive, print, printError }),
    })
}
