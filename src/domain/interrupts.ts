/**
 * Whether the operator has asked the run to stop. Asking the outside world about a signal reaches
 * out of the process, so it arrives as a port like the clock does.
 *
 * A run has only the one question, because there is only the one rule: the first interrupt drains —
 * start nothing new, let what is running finish and record — and the second one is not something
 * the run gets to observe at all, because it is already gone (ADR-0016).
 */
export type Interrupts = {
    /** True from the first interrupt on. Read once per pass of the loop, never trapped by a step. */
    draining: () => boolean
    /**
     * Takes the first interrupt for a process that drains nothing — the viewer: from the call on, it
     * aborts the signal handed back instead of draining, and nothing says it drains. A second one
     * still kills (ADR-0041). Called after the first interrupt, it hands back a signal already
     * aborted, and that one stays a drain.
     */
    quitOnFirst: () => AbortSignal
}
