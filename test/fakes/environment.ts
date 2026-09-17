import type { CopyEnvironmentFiles } from "../../src/domain/environment.ts"

export type FakeEnvironment = {
    copy: CopyEnvironmentFiles
    /** Every worktree the operator's environment files were copied into. */
    copiedInto: string[]
}

export const createFakeEnvironment = (): FakeEnvironment => {
    const copiedInto: string[] = []
    return {
        copiedInto,
        copy: async (_root, worktree) => {
            copiedInto.push(worktree)
        },
    }
}
