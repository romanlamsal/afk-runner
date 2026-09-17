import { z } from "zod"
import type { AgentProfile } from "./profiles.ts"

/**
 * The agent port. Every role afk has — planner, implementer, conflict resolver, fix agent, prepare
 * agent, pull request writer — is this one shape, because the differences between them are the
 * prompt, the schema and the profile, and all three are arguments.
 */

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
    /**
     * Called with this attempt's session id the moment the stream carries one, which is before any
     * model work. It is what lets the start event record a session that exists rather than one the
     * runner intended to create (ADR-0011, ADR-0017).
     */
    onSessionId: ((sessionId: string) => void) | undefined
    /** The role's structured output schema, handed to the agent inline. */
    outputSchema: z.core.JSONSchema.BaseSchema | undefined
    /** The models this role is invoked at, its own and its subagents' (ADR-0027). */
    profile: AgentProfile
}

/**
 * What one attempt consumed, read out of the stream rather than computed: these are the counts the
 * agent CLI reported. No dollar figure — the CLI computes one locally at list price and it is not a
 * bill, so recording it would invite exactly the reading ADR-0027 exists to prevent.
 *
 * The totals mix the models an attempt ran: the agent afk started and every subagent it spawned.
 * Which models those were is the step's profile, not something the stream has to say again.
 *
 * One declaration, here, because the event log persists exactly what the port produced. A second
 * one beside the event schema would be two constructors for one shape, free to drift apart.
 */
export const usageSchema = z.object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cacheReadInputTokens: z.number().nonnegative(),
    cacheCreationInputTokens: z.number().nonnegative(),
})

export type AgentUsage = z.infer<typeof usageSchema>

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
    /** Undefined when the stream carried no usage, which is a stream that never started. */
    usage: AgentUsage | undefined
}

export type AgentRunner = (invocation: AgentInvocation) => Promise<AgentResult>
