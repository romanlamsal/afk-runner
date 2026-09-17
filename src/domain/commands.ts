/**
 * The port through which the operator's own two commands run. `setup` and `verify` are strings the
 * operator confirmed (ADR-0014), so afk neither parses nor rewrites them: it runs them in a
 * worktree and reads whether they were happy.
 */

export type CommandResult = {
    ok: boolean
    /** Enough of the output to name a failure. Free text for an event's `detail`, never branched on. */
    detail: string
}

export type CommandRunner = (request: {
    /** The target repository's top level. */
    root: string
    /** The worktree to run in, relative to the root. */
    cwd: string
    command: string
}) => Promise<CommandResult>
