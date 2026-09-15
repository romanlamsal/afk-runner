import { z } from "zod"
import { manifestPath } from "./paths.ts"
import { deadlocked } from "./schedule.ts"

/**
 * The manifest is the whole contract between the planner and the run. It carries the spec, the two
 * commands the run needs, and the tickets with their edges — and nothing else. Branch names are
 * derived from the spec and the ticket numbers, so they are not stored; trunk is not stored because
 * the spec branch is cut from the local one at run start.
 *
 * The schema is a rule, not a description of one, so it lives here with the functions that read it.
 */

const ticketSchema = z.object({
    /** The issue number of the ticket. */
    number: z.int().positive(),
    /** The issue title, verbatim. */
    title: z.string().min(1),
    /** The ticket numbers this one is blocked by, as this repository records them. */
    blockedBy: z.array(z.int().positive()),
})

const manifestSchema = z.object({
    /** The issue number of the spec whose tickets these are. */
    spec: z.int().positive(),
    /** The command that prepares a checkout for use. */
    setup: z.string().min(1),
    /** The command that proves a checkout's integrity. */
    verify: z.string().min(1),
    tickets: z.array(ticketSchema).min(1),
})

export type Ticket = z.infer<typeof ticketSchema>
export type Manifest = z.infer<typeof manifestSchema>

export type ManifestRead = { ok: true; manifest: Manifest } | { ok: false; reason: string }

/** Where afk keeps the manifest. A driven port: the domain says what it needs, never how. */
export type ManifestStore = {
    /** What this spec's manifest is, or undefined when it has none. */
    read: (root: string, spec: number) => Promise<ManifestRead | undefined>
    write: (root: string, spec: number, manifest: Manifest) => Promise<void>
}

/**
 * The agent is handed this inline, generated at runtime. `$schema` is dropped because the CLI
 * validates against a validator with no meta-schema registered for the draft it names, and rejects
 * a document carrying one outright.
 */
export const manifestJsonSchema = (): z.core.JSONSchema.BaseSchema => {
    const { $schema, ...schema } = z.toJSONSchema(manifestSchema)
    return schema
}

const refuse = (reason: string): ManifestRead => ({ ok: false, reason })

const duplicate = (tickets: readonly Ticket[]): Ticket | undefined =>
    tickets.find((ticket, index) => tickets.findIndex(other => other.number === ticket.number) !== index)

/**
 * Everything afk knows about a manifest being usable, in one pass: the shape, that it answers the
 * question that was asked, and that it is a schedule rather than a knot.
 */
const readManifest = (raw: unknown, spec: number, source: string): ManifestRead => {
    const parsed = manifestSchema.safeParse(raw)
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
export const readPlannedManifest = (raw: unknown, spec: number): ManifestRead =>
    readManifest(raw, spec, "the planner's manifest")

/**
 * A manifest afk wrote itself is read back through the same rules: it was edited by hand, or written
 * by a version of afk that is no longer this one, as readily as not.
 */
export const readStoredManifest = (raw: unknown, spec: number): ManifestRead =>
    readManifest(raw, spec, `the manifest in ${manifestPath(spec)}`)
