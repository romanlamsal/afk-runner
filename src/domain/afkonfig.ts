import { z } from "zod"

/**
 * The afkonfig: `afkonfig.mts` at the repository's top level, checked in, pinning setup, verify or
 * both, so that the planner is asked only for what it does not pin (ADR-0039).
 *
 * The schema is a rule, so it lives here. It is strict because a faulty afkonfig fails loudly: a key
 * afk does not know is a typo of one it does, and falling back to the planner over it would re-derive
 * the very command the operator meant to pin.
 */

/** Where the afkonfig lives, relative to the repository's top level. One name, and no near miss. */
export const AFKONFIG_FILE = "afkonfig.mts"

/** Holds something besides whitespace: an empty command pins nothing, and is a mistake. */
const command = z.string({ error: "must be a string" }).regex(/\S/, { error: "must not be empty" }).optional()

const afkonfigSchema = z.strictObject(
    {
        /** The command that prepares a checkout for use. */
        setup: command,
        /** The command that proves a checkout's integrity. */
        verify: command,
    },
    { error: "the default export must be an object: export default { setup, verify }" },
)

/** What an afkonfig pins. An absent key is one the planner derives. */
export type Pinned = z.infer<typeof afkonfigSchema>

/** What a repository without an afkonfig pins, which is nothing. */
export const NOTHING_PINNED: Pinned = {}

export type AfkonfigRead = { ok: true; pinned: Pinned } | { ok: false; problems: readonly string[] }

/** What loading the file came to, before any rule was applied to what it exports. */
export type AfkonfigLoad =
    | { kind: "absent" }
    /** It would not import: a syntax error, syntax types cannot be stripped from, or a throw. */
    | { kind: "failed"; reason: string }
    | { kind: "loaded"; exports: Readonly<Record<string, unknown>> }

/** Where the afkonfig is kept. A driven port: the domain says what it needs, never how. */
export type AfkonfigFile = {
    /** Imports the afkonfig at the repository's top level, which executes it (ADR-0039). */
    load: (root: string) => Promise<AfkonfigLoad>
    /** Writes the afkonfig, over whatever was there. */
    write: (root: string, contents: string) => Promise<void>
}

/** What `afk config --init` writes: a valid afkonfig that pins nothing yet. */
export const AFKONFIG_TEMPLATE = [
    "export default {",
    '    // setup: "pnpm install --frozen-lockfile",',
    '    // verify: "pnpm run check",',
    "} satisfies { setup?: string; verify?: string }",
    "",
].join("\n")

const where = (path: readonly PropertyKey[]): string => (path.length === 0 ? "the default export" : path.join("."))

const problemsOf = (error: z.ZodError): string[] =>
    error.issues.map(issue =>
        issue.code === "unrecognized_keys"
            ? `${issue.keys.map(key => `"${key}"`).join(", ")}: not a key afk reads. Only setup and verify are`
            : `${where(issue.path)}: ${issue.message}`,
    )

/**
 * What a loaded afkonfig pins, or every reason it pins nothing — all of them at once, so that one
 * `afk config --check` is enough to correct the file.
 */
export const readAfkonfig = (exports: Readonly<Record<string, unknown>>): AfkonfigRead => {
    const named = Object.keys(exports)
        .filter(name => name !== "default")
        .map(name => `afkonfig.mts exports "${name}": only the default export is read`)

    if (!("default" in exports)) {
        return {
            ok: false,
            problems: ["afkonfig.mts has no default export: export default { setup, verify }", ...named],
        }
    }

    const parsed = afkonfigSchema.safeParse(exports.default)
    if (!parsed.success) {
        return { ok: false, problems: [...named, ...problemsOf(parsed.error)] }
    }
    if (named.length > 0) {
        return { ok: false, problems: named }
    }

    // `setup: undefined` is a key that pins nothing, and carried as it stands it would be laid over
    // the planner's answer as a missing command.
    const { setup, verify } = parsed.data
    return {
        ok: true,
        pinned: { ...(setup !== undefined && { setup }), ...(verify !== undefined && { verify }) },
    }
}
