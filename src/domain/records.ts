import type { StartMode } from "./mode.ts"

/** What earlier invocations for this spec left on disk. */
export type Records = {
    /** Whether this spec has a manifest. */
    manifest: boolean
    /**
     * Whether a run has begun: the log names a ticket, rather than the event log being on disk —
     * planning appends an event before any ticket is touched (ADR-0028).
     */
    started: boolean
}

/** What taking a run's records away came to. Nothing afk asks for goes unchecked (ADR-0005). */
export type RemovalResult = { ok: true } | { ok: false; reason: string }

/**
 * Where afk keeps a run's own records. A driven port: the domain says what it needs, never how.
 */
export type RunRecordStore = {
    /**
     * Create the run directory, ignoring itself, so that nothing afk writes reaches the repository's
     * status and nothing in it can be staged (ADR-0013).
     */
    create: (root: string, spec: number) => Promise<void>
    /**
     * Take the run directory away whole — manifest, event log, transcripts and whatever the
     * worktrees under it left behind. A directory that is not there is already what was asked for.
     *
     * The one step of starting over that cannot be retried into existence, so it goes last and it
     * reports rather than throws.
     */
    remove: (root: string, spec: number) => Promise<RemovalResult>
}

/**
 * What forbids a mode from starting against the records already on disk, as the operator should be
 * told it — every refusal names the mode that would do what they meant (ADR-0014).
 *
 * The bare invocation is the one this exists for: it is the mode that runs unattended, so what it is
 * about to do must never be a surprise. `--plan-only` replaces a manifest and asks nothing, because
 * that is the whole of what it does.
 */
export const refusalToStart = ({
    spec,
    mode,
    records,
    consented,
}: {
    spec: number
    mode: StartMode
    records: Records
    consented: boolean
}): string | undefined => {
    if (mode === "plan-only") {
        return undefined
    }

    if (mode === "implement-only") {
        if (!records.manifest) {
            return `spec #${spec} has no manifest to implement: plan it first, or drop --implement-only`
        }
        if (records.started && !consented) {
            return `spec #${spec} has a run already: pass --resume to continue it, or --force-fresh to start over`
        }
        return undefined
    }

    if (records.started) {
        return (
            `spec #${spec} has a run already: pass --implement-only --resume to continue it, ` +
            "or --force-fresh to start over"
        )
    }

    if (records.manifest) {
        return (
            `spec #${spec} has a manifest already: pass --implement-only to run it, ` +
            "--plan-only to replace it, or --force-fresh to start over"
        )
    }

    return undefined
}
