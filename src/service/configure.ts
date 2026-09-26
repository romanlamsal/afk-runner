import { AFKONFIG_FILE, AFKONFIG_TEMPLATE, type AfkonfigFile } from "../domain/afkonfig.ts"
import type { Git } from "../domain/git.ts"
import type { AfkonfigResult, ReadAfkonfig } from "./afkonfig.ts"

/**
 * What `afk config` was asked to do. `init-or-check` is the bare command: it checks an afkonfig that
 * is there and writes one that is not (ADR-0039).
 */
export type ConfigureAction = "init" | "check" | "init-or-check"

export type ConfigureResult = AfkonfigResult | { outcome: "written"; path: string }

/** The driving port: `afk config`, the one thing that writes the afkonfig. */
export type Configure = (action: ConfigureAction) => Promise<ConfigureResult>

export type ConfigureDeps = {
    /** Where afk was invoked. The afkonfig lives at this directory's git top level. */
    cwd: string
    git: Git
    afkonfig: AfkonfigFile
    /** The read service's driving port: checking is exactly what a run does before it plans. */
    read: ReadAfkonfig
}

/**
 * Writing or checking the afkonfig. Init overwrites without asking — the flag is the consent — and
 * whether the bare command inits is decided by whether the file is there at all, never by whether it
 * is valid: an invalid afkonfig is the operator's to correct, and overwriting it would throw away
 * what they meant to pin.
 */
export const createConfigureService =
    ({ cwd, git, afkonfig, read }: ConfigureDeps): Configure =>
    async action => {
        const init = async (): Promise<ConfigureResult> => {
            const root = await git.topLevel(cwd)
            if (root === undefined) {
                return {
                    outcome: "refused",
                    reason: "this is not a git worktree: run afk from inside the repository it is for",
                }
            }
            await afkonfig.write(root, AFKONFIG_TEMPLATE)
            return { outcome: "written", path: `${root}/${AFKONFIG_FILE}` }
        }

        if (action === "init") {
            return init()
        }

        const checked = await read()
        return action === "init-or-check" && checked.outcome === "absent" ? init() : checked
    }
