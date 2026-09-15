import type { AgentInvocation, AgentResult, AgentRunner } from "../domain/agent.ts"

/** What one step of one ticket came to, which is all the driver ever needs to know about it. */
export type StepResult =
    /** The step settled, for good or ill, and the log says which. */
    | { outcome: "ok" | "failed" }
    /** The run itself cannot continue. The driver drains and the process exits naming this. */
    | { outcome: "halted"; reason: string }

/**
 * One agent attempt, and the one property every service must give it: **two events, a start and an
 * end**, so that a run killed mid-step leaves a record that the step began (ADR-0011).
 *
 * The start is written the moment the stream carries a session id, which is before any model work:
 * what is recorded is a session that exists rather than one afk meant to create (ADR-0017). A
 * stream that carried no id never started, and the attempt still gets its start event.
 */
export const attemptWithAgent = async (
    agent: AgentRunner,
    invocation: Omit<AgentInvocation, "onSessionId">,
    start: (sessionId: string | undefined) => Promise<void>,
): Promise<AgentResult> => {
    let started: Promise<void> | undefined

    const result = await agent({
        ...invocation,
        onSessionId: observed => {
            started = start(observed)
        },
    })

    await (started ?? start(undefined))
    return result
}
