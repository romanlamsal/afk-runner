/**
 * One line tells the operator whether to look at git before anything else, so the codes are
 * distinct and closed.
 */
export const EXIT = {
    /** Every ticket verified, a ready pull request opened. */
    complete: 0,
    /** Some tickets failed or were skipped, a draft pull request opened. */
    partial: 1,
    /** A refused invocation: a bad flag combination, or no terminal without an explicit mode. */
    misuse: 2,
    /** The run stopped itself: a red spec branch independent of any ticket, or a tracker failure. */
    halted: 3,
    /** A second interrupt killed the run outright. */
    interrupted: 130,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]
