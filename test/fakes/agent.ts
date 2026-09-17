import type { AgentInvocation, AgentResult, AgentRunner } from "../../src/domain/agent.ts"

/**
 * The agent port's fake. It has no real counterpart in the contract suite knowingly: a real run
 * would cost a model call per assertion, so this adapter is covered by review.
 *
 * It announces its session id before it returns, the way the real adapter does, because that is
 * what the port promises — an id reaches the caller as soon as the stream carries one, and a fake
 * that skipped it would let a caller pass an assertion the real stream never grants (ADR-0017).
 */
export type FakeAgent = {
    run: AgentRunner
    /** Every invocation, in the order it was made. */
    invocations: AgentInvocation[]
}

export const createFakeAgent = (reply: Partial<AgentResult> = {}): FakeAgent => {
    const invocations: AgentInvocation[] = []
    return {
        invocations,
        run: async invocation => {
            invocations.push(invocation)
            const result: AgentResult = {
                outcome: "ok",
                sessionId: "session-from-the-stream",
                structuredOutput: undefined,
                detail: "",
                usage: undefined,
                ...reply,
            }
            if (result.sessionId !== undefined) {
                invocation.onSessionId?.(result.sessionId)
            }
            return result
        },
    }
}
