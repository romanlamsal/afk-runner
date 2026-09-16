/**
 * One line tells the operator whether to look at git before anything else, so the codes are
 * distinct and closed.
 */
export const EXIT = {
    /** Every ticket verified, a ready pull request opened. */
    complete: 0,
    /** Some tickets failed or were skipped, a draft pull request opened. */
    partial: 1,
    /**
     * The **arguments** were refused: a bad flag combination, or no terminal without an explicit
     * mode. Nothing on disk was read, so nothing about the repository can be the cause.
     */
    misuse: 2,
    /**
     * afk refused to start, or the run stopped itself. Refusing to start is this rather than
     * `misuse` because the arguments were fine and what went wrong is on disk: this is not a git
     * worktree, there is no manifest to implement, a run already exists, the gate worktree could
     * not be cut, or the operator closed the confirmation. Stopping itself is a planner that
     * produced no usable manifest, a red spec branch independent of any ticket, a tracker failure,
     * or a run that ended with no pull request — because nothing was verified, or because the push
     * or the create failed.
     */
    halted: 3,
    /** A second interrupt killed the run outright. */
    interrupted: 130,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]
