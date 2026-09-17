import { z } from "zod"
import { inlineJsonSchema } from "./schema.ts"

/**
 * What afk asks of the conflict resolver and what it asserts about what came back.
 *
 * The note is the whole of the resolver's output: the judgement it made, in its own words, so that
 * it can reach the squash commit's body and a reviewer learns an agent decided something inside
 * that commit. Nothing branches on it.
 */

const resolutionSchema = z.object({
    /** What was in conflict and how it was resolved, for the squash body. */
    note: z.string().min(1),
})

export const resolutionJsonSchema = (): z.core.JSONSchema.BaseSchema => inlineJsonSchema(resolutionSchema)

/**
 * What the resolver said it did, or nothing. A resolver that reported no note still resolved the
 * conflict — the note is for the reader of the commit, so its absence is not a fault.
 */
export const readResolutionNote = (raw: unknown): string | undefined => {
    const parsed = resolutionSchema.safeParse(raw)
    return parsed.success ? parsed.data.note : undefined
}

export type ResolverWork = {
    /** Whether the worktree still has a rebase in it after the resolver exited. */
    conflicted: boolean
    /** Whether the ticket's branch now contains the commit it was rebased onto. */
    onTip: boolean
    /** Whether anything of the ticket's own is left on top of that commit. */
    ahead: boolean
}

/**
 * What is wrong with what the resolver left behind, as the lifecycle event's `detail` should say
 * it, or nothing.
 *
 * Three assertions, and the last two exist because the two ways a resolver can make a conflict go
 * away without resolving it both leave a tree that looks finished. Aborting leaves the branch clean,
 * unconflicted and exactly where it started; skipping every commit leaves it clean, unconflicted
 * and equal to the tip, carrying nothing of the ticket. Both are caught by asking where the branch
 * is, which is the only kind of question afk asks of git (ADR-0004, ADR-0005).
 */
export const resolverFault = ({ conflicted, onTip, ahead }: ResolverWork): string | undefined => {
    if (conflicted) {
        return "the conflict resolver left the rebase unfinished"
    }
    if (!onTip) {
        return "the conflict resolver ended the rebase without landing it, so the ticket is where it started"
    }
    if (!ahead) {
        return "the conflict resolver resolved the ticket away: nothing of it is left on top of the spec branch"
    }
    return undefined
}
