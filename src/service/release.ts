import type { Git } from "../domain/git.ts"
import type { Holder, RunLock } from "../domain/lock.ts"

/** The driving port: this process is done with the spec, so the next afk may start on it. */
export type ReleaseRun = (spec: number) => Promise<void>

export type ReleaseDeps = {
    /** Where afk was invoked. The run directory is this directory's git top level. */
    cwd: string
    git: Git
    lock: RunLock
    /** This process, as the lock names it. Only the holder releases. */
    self: Holder
}

/**
 * Letting go of the run lock once a run ends, however it ended (ADR-0036). A process that never
 * gets here — killed, crashed — leaves a lock naming a pid that no longer exists, which is absent.
 */
export const createReleaseService =
    ({ cwd, git, lock, self }: ReleaseDeps): ReleaseRun =>
    async spec => {
        const root = await git.topLevel(cwd)
        if (root !== undefined) {
            await lock.release(root, spec, self)
        }
    }
