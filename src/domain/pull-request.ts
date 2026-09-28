import { z } from "zod"
import type { Progress } from "./events.ts"
import { inlineJsonSchema } from "./schema.ts"

/**
 * The one pull request a spec has, and the division of labour inside it: an agent writes a ready
 * one's prose, and the script composes everything a machine or a tracker reads from what the run
 * came to — and the whole of a draft (ADR-0040).
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
    /** A spec that is not whole is a draft, so nobody mistakes it for one (ADR-0007, ADR-0040). */
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

/** What became of the tickets, label by label, and only where there is any. */
const listed = (labelled: readonly (readonly [string, readonly number[]])[]): readonly string[] =>
    labelled.filter(([, some]) => some.length > 0).map(([label, some]) => `${label}: ${named(some)}`)

/** The three a run wrote down short of verified: everything it has to say without the manifest. */
const recorded = (progress: Progress): readonly (readonly [string, readonly number[]])[] => [
    ["failed", progress.failed],
    ["skipped", progress.skipped],
    ["not proven by the gate", progress.unverified],
]

/** One per verified ticket, composed from what the gate proved rather than from what an agent recalls. */
const closes = (progress: Progress): readonly string[] =>
    progress.verified.length === 0 ? [] : [progress.verified.map(ticket => `Closes #${ticket}`).join("\n")]

/** A ready pull request: the writer's prose, and the tickets it closes. Only a whole spec is one. */
export const composePullRequest = ({
    spec,
    progress,
    summary,
}: {
    spec: number
    progress: Progress
    summary: PullRequestSummary | undefined
}): PullRequest => ({
    title: summary?.title ?? `Spec #${spec}`,
    body: [
        summary?.summary ?? "afk's pull request writer produced no summary, so this body carries none.",
        ...closes(progress),
    ].join("\n\n"),
    draft: false,
})

/**
 * A draft: a backup of the spec branch, not a review. Without the run directory beside it there is
 * nothing a reviewer can act on, so it carries no prose and no writer is run for it — only where
 * every ticket of the manifest stands. It closes nothing, being rewritten before it can be merged
 * (ADR-0040).
 */
export const composeDraftPullRequest = ({
    spec,
    tickets,
    progress,
}: {
    spec: number
    /** Every ticket of the spec, so that one the run never reached is named rather than forgotten. */
    tickets: readonly number[]
    progress: Progress
}): PullRequest => ({
    title: `Spec #${spec}`,
    body: [
        `afk has not finished spec #${spec}; this draft is a backup of its spec branch.`,
        listed([
            ["verified", progress.verified],
            ["not proven by the gate", progress.unverified],
            ["failed", progress.failed],
            ["skipped", progress.skipped],
            ["never attempted", unattempted(tickets, progress)],
        ])
            .map(line => `- ${line}`)
            .join("\n"),
    ].join("\n\n"),
    draft: true,
})

/** A pull request the tracker holds for the spec branch, whatever became of it. */
export type FoundPullRequest = {
    number: number
    url: string
    state: "open" | "closed" | "merged"
    draft: boolean
}

/** Where an open pull request's draft flag has to move to agree with the spec; undefined is nowhere. */
export type DraftMark = "ready" | "draft" | undefined

export type PullRequestMove =
    /** Nothing open to update, and nothing the operator closed that a new one would override. */
    | { move: "open" }
    /** The open one is rewritten; `markAs` is where its draft flag disagrees with the spec. */
    | { move: "update"; number: number; url: string; markAs: DraftMark }
    /** A partial spec whose pull request the operator closed: it is not replaced by another draft. */
    | { move: "leave"; url: string }

/**
 * What the one spec PR a spec has calls for (ADR-0040). An open one is updated. With none open, a
 * whole spec opens a ready one whatever came before it, and a partial one opens a draft only where the
 * spec branch never had a pull request — a closed draft is the operator saying the backup is not
 * wanted. `found` is newest first, as the tracker port promises, so the link left is the latest.
 */
export const pullRequestMove = (found: readonly FoundPullRequest[], whole: boolean): PullRequestMove => {
    const open = found.find(pullRequest => pullRequest.state === "open")
    if (open !== undefined) {
        const disagrees = open.draft === whole
        return {
            move: "update",
            number: open.number,
            url: open.url,
            markAs: disagrees ? (whole ? "ready" : "draft") : undefined,
        }
    }

    const [before] = found
    return whole || before === undefined ? { move: "open" } : { move: "leave", url: before.url }
}

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
