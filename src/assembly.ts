import { type Cli, createCli } from "./cli/cli.ts"
import { createRun } from "./cli/run.ts"
import { createClaudeAgentRunner } from "./infrastructure/claude-agent-runner.ts"
import { createFileManifestStore } from "./repository/manifest-store.ts"
import { createPlanService } from "./service/plan.ts"

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

    // The invoking directory. Resolving the target repository from its git top level, and refusing
    // outside a git worktree, is the next ticket.
    const root = process.cwd()

    const plan = createPlanService({
        agent: createClaudeAgentRunner({ root }),
        manifests: createFileManifestStore({ root }),
        now: () => new Date(),
    })

    return createCli({
        isInteractive: () => process.stdin.isTTY === true,
        printError,
        run: createRun({ plan, print, printError }),
    })
}
