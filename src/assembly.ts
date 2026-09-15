import { type Cli, createCli } from "./cli/cli.ts"
import { createTerminalOperator } from "./cli/operator.ts"
import { createRun } from "./cli/run.ts"
import { createClaudeAgentRunner } from "./infrastructure/claude-agent-runner.ts"
import { createGit } from "./infrastructure/git.ts"
import { createFileManifestStore } from "./repository/manifest-store.ts"
import { createFileRunRecordStore } from "./repository/run-records.ts"
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

    const start = createStartService({
        // Where afk was invoked. The target repository is this directory's git top level, which the
        // start service resolves — nothing here assumes the two are the same.
        cwd: process.cwd(),
        git: createGit(),
        manifests,
        operator: createTerminalOperator({ input: process.stdin, output: process.stdout, print }),
        plan: createPlanService({ agent: createClaudeAgentRunner(), manifests, now: () => new Date() }),
        records: createFileRunRecordStore(),
    })

    return createCli({
        isInteractive: () => process.stdin.isTTY === true,
        printError,
        run: createRun({ start, print, printError }),
    })
}
