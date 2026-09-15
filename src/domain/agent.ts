import type { z } from "zod"

/**
 * The agent port. Every role afk has — planner, implementer, conflict resolver, fix agent, prepare
 * agent, pull request writer — is this one shape, because the differences between them are the
 * prompt and the schema, and both are arguments.
 */

/** One hour, for every external invocation afk makes. A wedged agent holds a slot for an hour, not a night. */
export const AGENT_TIMEOUT_MS = 60 * 60 * 1000

export type AgentInvocation = {
    /** Composed in the domain. */
    prompt: string
    /** The target repository's top level, which is where afk found it rather than where it was invoked. */
    root: string
    /** The worktree to run in, relative to the target repository. `.` is the repository itself. */
    cwd: string
    /** Where the stream is written as it arrives, relative to the target repository. */
    transcriptPath: string
    /** The session to continue. Only ever an id that was observed in a stream (ADR-0017). */
    resumeSessionId: string | undefined
    /** The role's structured output schema, handed to the agent inline. */
    outputSchema: z.core.JSONSchema.BaseSchema | undefined
}

export type AgentResult = {
    outcome: "ok" | "failed"
    /**
     * Read out of the stream, never generated: an id recorded here is a session that exists
     * (ADR-0017). Undefined when the stream carried none, which is a stream that never started.
     */
    sessionId: string | undefined
    /** The input of the structured-output tool call the stream carried, unread and unvalidated. */
    structuredOutput: unknown
    /** Free text for the lifecycle event's `detail`. Nothing ever branches on it. */
    detail: string
}

export type AgentRunner = (invocation: AgentInvocation) => Promise<AgentResult>
