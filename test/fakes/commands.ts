import type { CommandRunner } from "../../src/domain/commands.ts"

export type FakeCommands = {
    run: CommandRunner
    /** Every command run, in the order it was run, with the worktree it ran in. */
    ran: { cwd: string; command: string }[]
}

/** `failing` is the command every invocation of which fails; undefined is a repository where both pass. */
export const createFakeCommands = (failing?: string): FakeCommands => {
    const ran: { cwd: string; command: string }[] = []
    return {
        ran,
        run: async ({ cwd, command }) => {
            ran.push({ cwd, command })
            return command === failing
                ? { ok: false, detail: `\`${command}\` failed: exit 1` }
                : { ok: true, detail: "" }
        },
    }
}
