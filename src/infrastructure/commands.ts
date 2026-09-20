import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Clock } from "../domain/clock.ts"
import type { CommandResult, CommandRunner } from "../domain/commands.ts"
import { INVOCATION_TIMEOUT_MS } from "../domain/timeout.ts"
import { minutes, run } from "./process.ts"

/**
 * The operator's own `setup` and `verify`, run in a shell in a worktree.
 *
 * A shell because that is what the operator confirmed: `npm ci && npm run build` is one command to
 * them and must be one command here. afk neither parses nor rewrites what they typed.
 *
 * Everything the command says is appended to its log as it says it, each line stamped with when it
 * arrived: the result's `detail` is only a tail, and a red gate's whole failure has to be readable
 * after the fact. The command itself goes in first, so a log holding two of them reads as two.
 */
export const createShellCommandRunner = ({
    timeoutMs = INVOCATION_TIMEOUT_MS,
    now = () => new Date(),
}: {
    timeoutMs?: number
    now?: Clock
} = {}): CommandRunner => {
    return async ({ root, cwd, command, logPath }): Promise<CommandResult> => {
        const path = join(root, logPath)
        await mkdir(dirname(path), { recursive: true })
        const log = createWriteStream(path, { flags: "a" })
        // The log is a record of the command, not its result: a write that fails costs the reader
        // the output, and must not cost the step its answer or the process its life.
        log.on("error", () => undefined)
        const line = (text: string): void => {
            log.write(`${now().toISOString()} ${text}\n`)
        }

        // One partial line per stream, so that a chunk ending mid-line on stdout is never finished
        // by whatever stderr says next.
        const partial = { stdout: "", stderr: "" }
        const onOutput = (stream: "stdout" | "stderr", chunk: string): void => {
            const lines = (partial[stream] + chunk).split("\n")
            partial[stream] = lines.pop() ?? ""
            for (const text of lines) {
                line(text)
            }
        }

        line(`$ ${command}`)
        const startedAt = Date.now()
        const ran = await run("sh", ["-c", command], { cwd: join(root, cwd), timeoutMs, onOutput })
        for (const rest of [partial.stdout, partial.stderr].filter(rest => rest !== "")) {
            line(rest)
        }
        await new Promise<void>(resolve => log.end(resolve))

        if (ran.timedOut) {
            return { ok: false, detail: `\`${command}\` timed out after ${minutes(Date.now() - startedAt)}` }
        }

        const output = [ran.stderr, ran.stdout].find(stream => stream !== "") ?? ""
        return { ok: ran.ok, detail: ran.ok ? "" : `\`${command}\` failed: ${output}` }
    }
}
