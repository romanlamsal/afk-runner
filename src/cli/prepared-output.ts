import type { PreparedRun } from "../domain/run.ts"

/**
 * What a prepared run leaves on screen: where its branch came from, where its gate worktree is, and
 * the two commands as confirmed — so that what afk is about to do is on screen before the operator
 * walks away.
 */
export const preparedOutput = (run: PreparedRun): string[] => [
    `spec #${run.spec}: ${run.branch} cut from ${run.base}`,
    `gate:   ${run.gate}`,
    `setup:  ${run.manifest.setup}`,
    `verify: ${run.manifest.verify}`,
]
