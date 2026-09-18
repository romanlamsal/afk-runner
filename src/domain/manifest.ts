import { z } from "zod"
import { manifestPath } from "./paths.ts"
import { deadlocked } from "./schedule.ts"
import { inlineJsonSchema } from "./schema.ts"

/**
 * The manifest is the whole contract a run reads. It carries the spec, the two commands the run
 * needs, the tickets with their edges, and the branch the spec is based on. Branch names are derived
 * from the spec and the ticket numbers, so they are not stored.
 *
 * Two schemas, because the manifest has two authors. The planner is an agent, so what it returns is
 * a claim (ADR-0003) — and the base is not its claim to make, so the schema it is handed does not
 * have the field and afk writes it afterwards (ADR-0032). What is read back off disk has it.
 *
 * The schema is a rule, not a description of one, so it lives here with the functions that read it.
 */

/** What a manifest written before ADR-0032 is based on, and the last fallback for one written after. */
export const DEFAULT_BASE = "main"

const ticketSchema = z.object({
    /** The issue number of the ticket. */
    number: z.int().positive(),
    /** The issue title, verbatim. */
    title: z.string().min(1),
    /** The ticket numbers this one is blocked by, as this repository records them. */
    blockedBy: z.array(z.int().positive()),
})

/** Everything the planner is asked for, and the whole of what it is trusted to have an opinion on. */
const plannedManifestSchema = z.object({
    /** The issue number of the spec whose tickets these are. */
    spec: z.int().positive(),
    /** The command that prepares a checkout for use. */
    setup: z.string().min(1),
    /** The command that proves a checkout's integrity. */
    verify: z.string().min(1),
    tickets: z.array(ticketSchema).min(1),
})

const manifestSchema = plannedManifestSchema.extend({
    /**
     * The local branch this spec is based on, as afk resolved it when the spec was planned. Optional
     * because a manifest written before ADR-0032 has none, and one without it reads as
     * `DEFAULT_BASE` — never absent, so that nothing downstream has to ask twice.
     */
    base: z.string().min(1).optional(),
})

export type Ticket = z.infer<typeof ticketSchema>
export type PlannedManifest = z.infer<typeof plannedManifestSchema>
export type Manifest = z.infer<typeof manifestSchema>

/** What a manifest is based on. The one reader of the optional field, so the fallback lives once. */
export const baseOf = (manifest: Manifest): string => manifest.base ?? DEFAULT_BASE

export type ManifestRead = { ok: true; manifest: Manifest } | { ok: false; reason: string }

/** What the planner's output came to. The base is not on it yet: afk puts it there (ADR-0032). */
export type PlannedManifestRead = { ok: true; manifest: PlannedManifest } | { ok: false; reason: string }

/** Where afk keeps the manifest. A driven port: the domain says what it needs, never how. */
export type ManifestStore = {
    /** What this spec's manifest is, or undefined when it has none. */
    read: (root: string, spec: number) => Promise<ManifestRead | undefined>
    write: (root: string, spec: number, manifest: Manifest) => Promise<void>
}

/**
 * What the planner is asked to return, which is the manifest without the base: the field afk fills
 * in is not one the agent is shown, so there is nothing for it to invent (ADR-0032).
 */
export const manifestJsonSchema = (): z.core.JSONSchema.BaseSchema => inlineJsonSchema(plannedManifestSchema)

const duplicate = (tickets: readonly Ticket[]): Ticket | undefined =>
    tickets.find((ticket, index) => tickets.findIndex(other => other.number === ticket.number) !== index)

/**
 * Everything afk knows about a manifest being usable, in one pass: the shape, that it answers the
 * question that was asked, and that it is a schedule rather than a knot.
 *
 * The schema is a parameter because the planner's manifest and the stored one differ by one field
 * and by nothing else that these rules care about.
 */
const readManifest = <T extends PlannedManifest>(
    schema: z.ZodType<T>,
    raw: unknown,
    spec: number,
    source: string,
): { ok: true; manifest: T } | { ok: false; reason: string } => {
    const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
        return refuse(`${source} does not match the schema: ${z.prettifyError(parsed.error)}`)
    }

    const manifest = parsed.data
    if (manifest.spec !== spec) {
        return refuse(`${source} is for spec #${manifest.spec}, not #${spec}`)
    }

    const twice = duplicate(manifest.tickets)
    if (twice !== undefined) {
        return refuse(`${source} lists ticket #${twice.number} twice`)
    }

    const stuck = deadlocked(manifest.tickets)
    if (stuck.length > 0) {
        const named = stuck.map(ticket => `#${ticket.number}`).join(", ")
        return refuse(`${source} has tickets blocked by each other, so none of them can start: ${named}`)
    }

    return { ok: true, manifest }
}

/** A planner is an agent, so its output is read as a claim and never as a fact (ADR-0003). */
export const readPlannedManifest = (raw: unknown, spec: number): PlannedManifestRead =>
    readManifest(plannedManifestSchema, raw, spec, "the planner's manifest")

/**
 * A manifest afk wrote itself is read back through the same rules: it was edited by hand, or written
 * by a version of afk that is no longer this one, as readily as not.
 */
export const readStoredManifest = (raw: unknown, spec: number): ManifestRead =>
    readManifest(manifestSchema, raw, spec, `the manifest in ${manifestPath(spec)}`)

export type TicketLookup = { ok: true; ticket: Ticket } | { ok: false; reason: string }

/**
 * A step is only ever run for a ticket the manifest names. A number that is not one is the log and
 * the manifest disagreeing rather than a ticket that failed, so every caller stops the run over it
 * rather than the step — which is why the rule and its words are here and not in each of them.
 */
export const ticketOf = (manifest: Manifest, spec: number, ticket: number): TicketLookup => {
    const listed = manifest.tickets.find(one => one.number === ticket)
    return listed === undefined
        ? { ok: false, reason: `#${ticket} is not a ticket of spec #${spec}` }
        : { ok: true, ticket: listed }
}
