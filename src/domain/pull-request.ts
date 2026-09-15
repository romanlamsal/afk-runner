import { z } from "zod"
import type { Progress } from "./events.ts"
import { inlineJsonSchema } from "./schema.ts"

/**
 * The one pull request a run opens, and the division of labour inside it: an agent writes the prose,
 * and the script composes everything a machine or a tracker reads from what the run came to.
 *
 * The closing references are the script's for the same reason the squash trailer is — they are a
 * statement about what the gate proved, and an agent recollecting which tickets those were is a
 * second constructor for a fact the event log already holds (ADR-0007, ADR-0011).
 */

/** What the writer is asked for: both halves, and neither of them empty. */
const summarySchema = z.object({
    /** The pull request's title, as a reviewer reads it in a list. */
    title: z.string().min(1),
    /** What landed and why, for whoever has to review it. */
    summary: z.string().min(1),
})

export type PullRequestSummary = { title: string | undefined; summary: string | undefined }

export const pullRequestJsonSchema = (): z.core.JSONSchema.BaseSchema => inlineJsonSchema(summarySchema)

/**
 * The same two fields read one at a time. What is asked for and what is accepted differ on purpose:
 * a writer that wrote a good title and left the summary blank keeps its title, because losing it as
 * well would be afk throwing away work the agent did.
 */
const readSchema = z.object({
    title: z.string().min(1).optional().catch(undefined),
    summary: z.string().min(1).optional().catch(undefined),
})

const NOTHING_SAID: PullRequestSummary = { title: undefined, summary: undefined }

/**
 * What the writer said, half by half. A writer that produced nothing usable does not cost the run
 * its pull request: the branch is pushed and the work is verified either way, and a body that says
 * the prose is missing is honest where one afk invented would not be.
 */
export const readPullRequestSummary = (raw: unknown): PullRequestSummary => {
    const parsed = readSchema.safeParse(raw)
    return parsed.success ? { title: parsed.data.title, summary: parsed.data.summary } : NOTHING_SAID
}

export type PullRequest = {
    title: string
    body: string
    /** A run that is not the whole spec opens a draft, so that nobody mistakes it for one (ADR-0007). */
    draft: boolean
}

/** Every ticket of the spec proven by the gate, which is the only thing a ready pull request is. */
export const wholeSpec = (tickets: readonly number[], progress: Progress): boolean =>
    tickets.every(ticket => progress.verified.includes(ticket))

const named = (tickets: readonly number[]): string => tickets.map(ticket => `#${ticket}`).join(", ")

/** A ticket of the spec that none of the four outcomes claims: the run never got to it. */
const unattempted = (tickets: readonly number[], progress: Progress): readonly number[] => {
    const accounted = new Set([...progress.verified, ...progress.unverified, ...progress.failed, ...progress.skipped])
    return tickets.filter(ticket => !accounted.has(ticket))
}

/** What became of everything the gate did not prove, label by label, and only where there is any. */
const listed = (labelled: readonly (readonly [string, readonly number[]])[]): readonly string[] =>
    labelled.filter(([, some]) => some.length > 0).map(([label, some]) => `${label}: ${named(some)}`)

/** The three a run wrote down, which is everything it has to say without the manifest beside it. */
const recorded = (progress: Progress): readonly (readonly [string, readonly number[]])[] => [
    ["failed", progress.failed],
    ["skipped", progress.skipped],
    ["not proven by the gate", progress.unverified],
]

/** What a reviewer is told the pull request is missing, where it is missing anything. */
const missing = (spec: number, tickets: readonly number[], progress: Progress): readonly string[] => {
    const lines = listed([...recorded(progress), ["never attempted", unattempted(tickets, progress)]])
    return lines.length === 0
        ? []
        : [[`This pull request is not the whole of spec #${spec}:`, ...lines.map(line => `- ${line}`)].join("\n")]
}

/** One per verified ticket, composed from what the gate proved rather than from what an agent recalls. */
const closes = (progress: Progress): readonly string[] =>
    progress.verified.length === 0 ? [] : [progress.verified.map(ticket => `Closes #${ticket}`).join("\n")]

export const composePullRequest = ({
    spec,
    tickets,
    progress,
    summary,
}: {
    spec: number
    /** Every ticket of the spec, so that one the run never reached is named rather than forgotten. */
    tickets: readonly number[]
    progress: Progress
    summary: PullRequestSummary | undefined
}): PullRequest => ({
    title: summary?.title ?? `Spec #${spec}`,
    body: [
        summary?.summary ?? "afk's pull request writer produced no summary, so this body carries none.",
        ...missing(spec, tickets, progress),
        ...closes(progress),
    ].join("\n\n"),
    draft: !wholeSpec(tickets, progress),
})

/**
 * Why a run opens no pull request at all. Nothing verified means nothing the gate proved, and an
 * empty change is not something to hand a reviewer — so the run says what became of the tickets
 * instead and exits non-zero.
 */
export const noPullRequestReason = (spec: number, progress: Progress): string => {
    const became = listed(recorded(progress))
    const what = became.length === 0 ? "nothing was attempted" : became.join(", ")
    return `no ticket of spec #${spec} was verified, so there is no pull request to open: ${what}`
}
