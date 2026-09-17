import type { Manifest } from "./manifest.ts"

/**
 * A run that is ready to implement: everything a ticket needs in order to be handed to an
 * implementer. It is decided once, at start, and read by every service after that.
 */
export type PreparedRun = {
    /** The target repository's top level. */
    root: string
    spec: number
    /** The local branch the spec branch was cut from. */
    trunk: string
    /** The spec branch. */
    branch: string
    /** The gate worktree, relative to the root: the spec branch's sole writer (ADR-0006). */
    gate: string
    /** The manifest as confirmed — the commands in it are the ones that will run. */
    manifest: Manifest
}
