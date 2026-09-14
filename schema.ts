import { fileURLToPath } from "node:url"
import { z } from "zod"

/**
 * The manifest is the whole contract between the planner and the orchestrator.
 *
 * It is authored here and consumed as `schema.json`, which is generated from this file and
 * committed. Node resolves bare specifiers relative to the importing file, so `zod` is unreachable
 * from a top-level `afk/` in most repos; the committed JSON is what actually reaches the planner.
 */

export const TicketSchema = z.object({
    /** The GitHub issue number of the ticket. */
    number: z.int().positive(),
    /** The issue title, verbatim. */
    title: z.string().min(1),
    /** The branch the implementer commits on. */
    branch: z.string().min(1),
    /** Ticket numbers this one is blocked by, as stated in its `## Blocked by` section. */
    blockedBy: z.array(z.int().positive()),
})

export const LayerSchema = z.object({
    /** The branch every ticket in this layer is squash-merged into. */
    branch: z.string().min(1),
    tickets: z.array(TicketSchema).min(1),
})

export const ManifestSchema = z.object({
    /** The GitHub issue number of the spec. */
    spec: z.int().positive(),
    /** The branch the bottom layer stacks onto — the repository's default branch. */
    trunk: z.string().min(1),
    /** Topological layers, in execution order. Layer n may only be blocked by layers before it. */
    layers: z.array(LayerSchema).min(1),
})

export type Ticket = z.infer<typeof TicketSchema>
export type Layer = z.infer<typeof LayerSchema>
export type Manifest = z.infer<typeof ManifestSchema>

/**
 * `claude -p --json-schema` validates against a validator with no meta-schema registered for the
 * draft 2020-12 `$schema` ref, and rejects the document outright if it carries one. The key is
 * dropped here so the committed `schema.json` is exactly what the CLI accepts.
 */
export const manifestJsonSchema = (): unknown => {
    const schema: Record<string, unknown> = { ...z.toJSONSchema(ManifestSchema) }
    delete schema.$schema
    return schema
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log(JSON.stringify(manifestJsonSchema(), null, 4))
}
