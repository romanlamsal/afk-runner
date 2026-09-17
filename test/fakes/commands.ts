import type { CommandRunner } from "../../src/domain/commands.ts"

export type FakeCommands = {
    run: CommandRunner
    /** Every command run, in the order it was run, with the worktree it ran in. */
    ran: { cwd: string; command: string }[]
    /** Stop the failing command failing, as whatever broke the repository being taken away does. */
    mend: () => void
}

/** `failing` is the command every invocation of which fails; undefined is a repository where both pass. */
export const createFakeCommands = (failing?: string): FakeCommands => {
    const ran: { cwd: string; command: string }[] = []
    let broken = failing

    return {
        ran,
        mend: () => {
            broken = undefined
        },
        run: async ({ cwd, command }) => {
            ran.push({ cwd, command })
            return command === broken
                ? { ok: false, detail: `\`${command}\` failed: exit 1` }
                : { ok: true, detail: "" }
        },
    }
}
