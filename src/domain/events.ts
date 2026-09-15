import { z } from "zod"

/**
 * The lifecycle event log: the record of what was attempted and how far it got.
 *
 * Two things make it the only state afk keeps. It is append-only — an event is written when a step
 * starts and a second when it ends, and nothing is ever rewritten — so a torn write costs the last
 * line rather than the file. And status is the last event, derived on read and never stored, so two
 * representations of one fact cannot disagree (ADR-0011).
 */

/**
 * Closed by decision. The step is what recovery keys on, which is why adding to this is a deliberate
 * act rather than a convenience (ADR-0011).
 */
export const STEPS = ["implement", "prepare", "rebase", "resolve", "merge", "gate", "revert"] as const

export type Step = (typeof STEPS)[number]

export const OUTCOMES = ["running", "ok", "failed", "skipped"] as const

export type Outcome = (typeof OUTCOMES)[number]

const eventSchema = z.object({
    /** The ticket this happened to. */
    ticket: z.int().positive(),
    step: z.enum(STEPS),
    outcome: z.enum(OUTCOMES),
    /** When it was appended, as an ISO instant. Never branched on. */
    at: z.string().min(1),
    /**
     * The attempt's session, read out of the stream rather than generated: an id here is a session
     * that exists (ADR-0017). It belongs to the attempt, not to the ticket.
     */
    sessionId: z.string().optional(),
    /** The commit a ticket's worktree was cut from, carried by an implementer's start event. */
    baseSha: z.string().optional(),
    /** Where the attempt's transcript is, relative to the repository root. */
    transcriptPath: z.string().optional(),
    /** Free text. There is no closed enum of failure reasons, and nothing ever branches on this. */
    detail: z.string().optional(),
})

export type LifecycleEvent = z.infer<typeof eventSchema>

/**
 * One line of the log, or nothing. The log is read defensively on purpose: the last line of one a
 * killed run left behind is as likely to be half-written as not, and losing only that line is the
 * whole point of one object per line.
 */
export const readEvent = (raw: unknown): LifecycleEvent | undefined => {
    const parsed = eventSchema.safeParse(raw)
    return parsed.success ? parsed.data : undefined
}

/** Where afk keeps the event log. A driven port: the domain says what it needs, never how. */
export type EventLog = {
    /** Every event for this spec, oldest first. A spec with no log has no events. */
    read: (root: string, spec: number) => Promise<readonly LifecycleEvent[]>
    append: (root: string, spec: number, event: LifecycleEvent) => Promise<void>
}

/** A ticket's status is its last event, and there is nothing else to it (ADR-0011). */
export const statusOf = (events: readonly LifecycleEvent[], ticket: number): LifecycleEvent | undefined =>
    events.findLast(event => event.ticket === ticket)

/**
 * How many times a step has been attempted, counted from its start events. Nothing stores a counter,
 * so nothing can hold one that disagrees with the log.
 */
export const attempts = (events: readonly LifecycleEvent[], ticket: number, step: Step): number =>
    events.filter(event => event.ticket === ticket && event.step === step && event.outcome === "running").length

/** Only the gate produces verified, and a ticket reverted after one stops being verified (ADR-0015). */
export const verified = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const last = statusOf(events, ticket)
    return last?.step === "gate" && last.outcome === "ok"
}

/** A ticket nothing more will happen to: it failed for good, or it was skipped. */
export const settled = (events: readonly LifecycleEvent[], ticket: number): boolean => {
    const outcome = statusOf(events, ticket)?.outcome
    return outcome === "failed" || outcome === "skipped"
}

/**
 * A ticket whose last event says a step began and never ended. Whether that step is *happening* is
 * a question the log cannot answer — only the driver's live action set can (ADR-0019).
 */
export const running = (events: readonly LifecycleEvent[], ticket: number): boolean =>
    statusOf(events, ticket)?.outcome === "running"

/** A ticket the log has never mentioned, which is the only kind a first attempt is handed out for. */
export const unattempted = (events: readonly LifecycleEvent[], ticket: number): boolean =>
    statusOf(events, ticket) === undefined

/**
 * What a skip is written down as. The step is `implement`, because implementing is the work that
 * will not happen; the detail says why, and like every detail nothing ever branches on it.
 */
export const skipped = (ticket: number, at: Date): LifecycleEvent => ({
    ticket,
    step: "implement",
    outcome: "skipped",
    at: at.toISOString(),
    detail: "a ticket it is blocked by will not land",
})

export type Progress = {
    implemented: readonly number[]
    failed: readonly number[]
    skipped: readonly number[]
}

/** What the log says a run came to, read for the operator rather than for a decision. */
export const progressOf = (tickets: readonly number[], events: readonly LifecycleEvent[]): Progress => {
    const withOutcome = (outcome: Outcome): readonly number[] =>
        tickets.filter(ticket => statusOf(events, ticket)?.outcome === outcome)

    return { implemented: withOutcome("ok"), failed: withOutcome("failed"), skipped: withOutcome("skipped") }
}
