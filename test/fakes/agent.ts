import type { AgentInvocation, AgentResult, AgentRunner } from "../../src/domain/agent.ts"

/**
 * The agent port's fake. It has no real counterpart in the contract suite knowingly: a real run
 * would cost a model call per assertion, so this adapter is covered by review.
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
            return {
                outcome: "ok",
                sessionId: "session-from-the-stream",
                structuredOutput: undefined,
                detail: "",
                ...reply,
            }
        },
    }
}
