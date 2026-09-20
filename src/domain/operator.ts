import type { Holder } from "./lock.ts"
import type { Notice } from "./preflight.ts"

/** The two commands a run needs. The manifest carries the planner's proposal; this is what runs. */
export type Commands = { setup: string; verify: string }

export type ConfirmationScreen = {
    /** Warnings first, then notes. Part of the decision, not a separate one. */
    notices: readonly Notice[]
    /** The planner's proposal, shown pre-filled and edited in place. */
    commands: Commands
}

/**
 * The port through which afk speaks to the person who started it.
 *
 * One screen and one decision (ADR-0014): the notices, then `setup`, then `verify`. Nothing else is
 * asked, and nothing is asked twice — the confirmation is the only thing standing between a
 * planner-authored string and the operator's machine.
 *
 * The one question asked before it is whether to take over a run another afk holds (ADR-0035). It
 * is the same accept-or-abort shape, and it is asked only where there is a terminal to ask on.
 */
export type Operator = {
    /** Say what the state of the repository is, and ask nothing. */
    report: (notices: readonly Notice[]) => Promise<void>
    /** The confirmation screen. Undefined when the operator aborted instead of deciding. */
    confirm: (screen: ConfirmationScreen) => Promise<Commands | undefined>
    /** Whether to take over the run `holder` has of `spec`. Anything but a yes is a no. */
    takeOver: (spec: number, holder: Holder) => Promise<boolean>
}
