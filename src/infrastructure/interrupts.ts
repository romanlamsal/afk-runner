import type { Interrupts } from "../domain/interrupts.ts"

/**
 * The interrupt, handled once for the whole process so that no step has to handle it at all
 * (ADR-0016). What a signal is, and what leaving looks like, arrive as arguments: this module
 * counts interrupts and says what each one means.
 */
export type SignalInterruptDeps = {
    /** Registers the handler every interrupt signal runs. The real one subscribes `process.on`. */
    listen: (handler: () => void) => void
    /** Leaving, now, with nothing unwound. The real one exits `130`. */
    kill: () => void
    /** Where the operator is told what their interrupt did. */
    notify: (line: string) => void
}

const DRAINING =
    "afk: interrupted — starting nothing new, and what is running will finish. Interrupt again to kill the run."

const KILLING = "afk: killed. Nothing was unwound; the next start picks the run up where it stopped."

/**
 * The first interrupt drains and the second kills. Draining is a courtesy — a lifecycle event is
 * written when a step *starts*, so a kill at any point leaves a state the next start can dispatch
 * on, and nothing downstream may assume a run exited cleanly.
 */
export const createSignalInterrupts = ({ listen, kill, notify }: SignalInterruptDeps): Interrupts => {
    let interrupts = 0

    listen(() => {
        interrupts += 1
        notify(interrupts === 1 ? DRAINING : KILLING)
        if (interrupts > 1) {
            kill()
        }
    })

    return { draining: () => interrupts > 0 }
}
