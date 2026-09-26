import { EXIT, type ExitCode } from "../../src/cli/exit-codes.ts"
import type { AfkonfigFile, AfkonfigLoad } from "../../src/domain/afkonfig.ts"
import type { ReadAfkonfig } from "../../src/service/afkonfig.ts"
import type { ConfigureAction } from "../../src/service/configure.ts"

export type FakeAfkonfigFile = {
    file: AfkonfigFile
    /** Every repository an afkonfig was loaded from. */
    loadedFrom: string[]
    /** Every afkonfig written, in order. */
    written: { root: string; contents: string }[]
}

/**
 * An afkonfig that loads as it is told to. What loading a real file comes to — a module, a syntax
 * error, nothing — is the adapter's integration test; the rules over what it exported are the
 * domain's.
 */
export const createFakeAfkonfigFile = (load: AfkonfigLoad = { kind: "absent" }): FakeAfkonfigFile => {
    const loadedFrom: string[] = []
    const written: { root: string; contents: string }[] = []
    return {
        loadedFrom,
        written,
        file: {
            load: async root => {
                loadedFrom.push(root)
                return load
            },
            write: async (root, contents) => {
                written.push({ root, contents })
            },
        },
    }
}

/** A read that finds no afkonfig, for the flows that are not about one: nothing is pinned. */
export const createStubReadAfkonfig = (): ReadAfkonfig => async () => ({ outcome: "absent" })

/** `afk config`, stubbed for the flows that run a spec and never invoke it. */
export const createStubConfig = (): ((action: ConfigureAction) => Promise<ExitCode>) => async () => EXIT.complete
