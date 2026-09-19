/**
 * Everything afk writes lives under one directory inside the target repository, and every path to
 * it is derived here — relative to the repository root, so that the rules stay pure and the
 * adapters own the only absolute path there is.
 */

/** Machine-local, and nothing in it is expected to exist on another machine (ADR-0013). */
export const AFK_DIR = ".afk"

/** The run directory: one spec's manifest, event log, worktrees and transcripts. */
export const runDirectory = (spec: number): string => `${AFK_DIR}/${spec}`

export const manifestPath = (spec: number): string => `${runDirectory(spec)}/manifest.json`

/** The append-only record of every lifecycle event. Its presence is what makes a run an existing one. */
export const eventLogPath = (spec: number): string => `${runDirectory(spec)}/events.jsonl`

/** The run directory's own ignore file. It ignores everything beside it, itself included (ADR-0013). */
export const runIgnorePath = (spec: number): string => `${runDirectory(spec)}/.gitignore`

/** The one long-lived worktree holding the spec branch, and its sole writer (ADR-0006). */
export const gateWorktree = (spec: number): string => `${runDirectory(spec)}/gate`

/**
 * One worktree per ticket, cut when its implementer starts and removed once the ticket is verified.
 * A failed or skipped ticket keeps its own: that is what the prepare agent reads (ADR-0012).
 */
export const ticketWorktree = (spec: number, ticket: number): string => `${runDirectory(spec)}/t${ticket}`

/**
 * `20260915T111838314Z` — sorts chronologically as a string, and carries no character a path
 * dislikes. It keeps its milliseconds: two attempts starting in the same second must not land in
 * one file.
 */
const stamp = (at: Date): string => at.toISOString().replace(/[-:.]/g, "")

/**
 * One transcript per attempt, named for when it started and what it was doing. Chronological by
 * name so that reading a run means listing a directory.
 */
export const transcriptPath = (spec: number, label: string, at: Date): string =>
    `${runDirectory(spec)}/transcripts/${stamp(at)}-${label}.jsonl`

/**
 * One log per attempt at a step that runs the operator's own commands, named like a transcript. A
 * step running two commands — the gate's `setup` then `verify` — writes both into the one file.
 */
export const commandLogPath = (spec: number, label: string, at: Date): string =>
    `${runDirectory(spec)}/commands/${stamp(at)}-${label}.log`

/**
 * Who holds the run: the one afk process allowed to write this run directory (ADR-0034). Inside it,
 * so the directory's own ignore file covers it and starting over takes it away with everything else.
 */
export const runLockPath = (spec: number): string => `${runDirectory(spec)}/lock`
