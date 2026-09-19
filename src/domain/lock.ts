/**
 * One afk per spec (ADR-0034). A run takes a lock on its run directory, so that a second process
 * cannot start on a spec that already has one and force its way into the first one's worktrees.
 */

/** The process a lock names. A pid is all it takes to tell whether that process still exists. */
export type Holder = { pid: number }

/** What asking for the lock came to: it is held now, or somebody live already holds it. */
export type Acquired = { ok: true } | { ok: false; holder: Holder }

/**
 * The run lock. A driven port: the domain says what a lock is, the adapter owns the file and the
 * pid behind it.
 *
 * The rules every implementation keeps:
 * - **A holder is live while its process exists.** A lock whose holder no longer exists is absent,
 *   so a crashed run needs no cleanup before the next start.
 * - **A holder asking again already has it.** Starting over and then starting are one process
 *   asking twice, and the second ask is not a second afk.
 * - **Only the holder releases.** Releasing a lock somebody else holds leaves it held.
 */
export type RunLock = {
    /** Take the lock for `self`, unless a live holder other than `self` has it. */
    acquire: (root: string, spec: number, self: Holder) => Promise<Acquired>
    /** Give the lock up, if `self` is what holds it. */
    release: (root: string, spec: number, self: Holder) => Promise<void>
    /** The live holder of the lock, if there is one. Reads, and never writes. */
    holder: (root: string, spec: number) => Promise<Holder | undefined>
}

/**
 * Whether a lock names somebody other than the asking process. The asker's own lock is not a
 * refusal: it is the one it already holds.
 */
export const heldByAnother = (holder: Holder | undefined, self: Holder): holder is Holder =>
    holder !== undefined && holder.pid !== self.pid

/** The refusal a second start gets, naming the process that stopped it (ADR-0034). */
export const refusalToShare = (spec: number, holder: Holder): string =>
    `spec #${spec} is already being run by afk process ${holder.pid}: ` +
    "wait for it to finish, or stop it before starting another"
