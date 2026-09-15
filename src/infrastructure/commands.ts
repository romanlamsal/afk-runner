import { join } from "node:path"
import type { CommandResult, CommandRunner } from "../domain/commands.ts"
import { INVOCATION_TIMEOUT_MS } from "../domain/timeout.ts"
import { minutes, run } from "./process.ts"

/**
 * The operator's own `setup` and `verify`, run in a shell in a worktree.
 *
 * A shell because that is what the operator confirmed: `npm ci && npm run build` is one command to
 * them and must be one command here. afk neither parses nor rewrites what they typed.
 */
export const createShellCommandRunner = ({
    timeoutMs = INVOCATION_TIMEOUT_MS,
}: {
    timeoutMs?: number
} = {}): CommandRunner => {
    return async ({ root, cwd, command }): Promise<CommandResult> => {
        const startedAt = Date.now()
        const ran = await run("sh", ["-c", command], { cwd: join(root, cwd), timeoutMs })

        if (ran.timedOut) {
            return { ok: false, detail: `\`${command}\` timed out after ${minutes(Date.now() - startedAt)}` }
        }

        const said = [ran.stderr, ran.stdout].find(output => output !== "") ?? ""
        return { ok: ran.ok, detail: ran.ok ? "" : `\`${command}\` failed: ${said}` }
    }
}
