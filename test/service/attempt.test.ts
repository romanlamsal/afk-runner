import { describe, expect, it } from "vitest"
import type { AgentInvocation, AgentResult, AgentRunner } from "../../src/domain/agent.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import { attemptWithAgent } from "../../src/service/attempt.ts"

/**
 * The one property every service's agent attempt must have: **two events, a start and an end**, so
 * that a run killed mid-step leaves a record that the step began (ADR-0011).
 *
 * What is asserted is what the start was told and that it was waited for — never how the runner
 * learned the id, which is the adapter's business and the stream's.
 */

const INVOCATION: Omit<AgentInvocation, "onSessionId"> = {
    prompt: "do the work",
    root: "/repo",
    cwd: ".afk/4/t7",
    transcriptPath: ".afk/4/transcripts/t7.jsonl",
    resumeSessionId: undefined,
    outputSchema: undefined,
    profile: PROFILES.implementer,
}

/** An agent whose stream carries `sessionId`, announced the way the real adapter announces it. */
const agentAnnouncing = (sessionId: string | undefined): AgentRunner => {
    return async invocation => {
        if (sessionId !== undefined) {
            invocation.onSessionId?.(sessionId)
        }
        return { outcome: "ok", sessionId, structuredOutput: undefined, detail: "", usage: undefined }
    }
}

/** A start the test does not assert on: the attempt still gets one, because every attempt must. */
const noStart = async (): Promise<void> => {
    return
}

describe("attemptWithAgent", () => {
    it.each([
        ["an id the stream carried", "session-from-the-stream", "session-from-the-stream"],
        ["nothing, where the stream carried no id", undefined, undefined],
    ] as const)("should start the attempt with %s", async (_case, carried, expected) => {
        // given
        const started: (string | undefined)[] = []

        // when
        await attemptWithAgent(agentAnnouncing(carried), INVOCATION, async observed => {
            started.push(observed)
        })

        // then
        expect(started).toEqual([expected])
    })

    it("should start the attempt exactly once", async () => {
        // given
        const started: (string | undefined)[] = []

        // when
        await attemptWithAgent(agentAnnouncing("session-from-the-stream"), INVOCATION, async observed => {
            started.push(observed)
        })

        // then
        expect(started).toHaveLength(1)
    })

    it("should wait for the start before returning, so a killed run finds the step began", async () => {
        // given
        let recorded = false
        const slowStart = async (): Promise<void> => {
            await new Promise(resolve => setTimeout(resolve, 0))
            recorded = true
        }

        // when
        await attemptWithAgent(agentAnnouncing("session-from-the-stream"), INVOCATION, slowStart)

        // then
        expect(recorded).toBe(true)
    })

    it("should return what the agent reported", async () => {
        // given
        const reported: AgentResult = {
            outcome: "failed",
            sessionId: "session-from-the-stream",
            structuredOutput: { note: "it went wrong" },
            detail: "the checks did not pass",
            usage: { inputTokens: 12, outputTokens: 34, cacheReadInputTokens: 56, cacheCreationInputTokens: 78 },
        }
        const agent: AgentRunner = async invocation => {
            invocation.onSessionId?.("session-from-the-stream")
            return reported
        }

        // when
        const result = await attemptWithAgent(agent, INVOCATION, noStart)

        // then
        expect(result).toEqual(reported)
    })

    it("should pass the invocation through to the agent untouched", async () => {
        // given
        const invocations: AgentInvocation[] = []
        const agent: AgentRunner = async invocation => {
            invocations.push(invocation)
            return { outcome: "ok", sessionId: undefined, structuredOutput: undefined, detail: "", usage: undefined }
        }

        // when
        await attemptWithAgent(agent, INVOCATION, noStart)

        // then
        expect(invocations[0]).toMatchObject(INVOCATION)
    })
})
