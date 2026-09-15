import { spawn } from "node:child_process"

/**
 * Running another program, which is the one thing every adapter in this layer does. It is here
 * rather than in each of them so that "a command afk ran" means the same thing everywhere: output
 * captured, exit code read, and a process that will not start reported as a failure rather than
 * thrown.
 */

export type Ran = {
    ok: boolean
    stdout: string
    stderr: string
    /** Whether the process was killed for running past its timeout. */
    timedOut: boolean
}

/** Enough of the tail to name a failure, without holding a wedged process's whole output. */
const TAIL = 4000

/** What a timed-out process gets to shut down in before it is killed outright. */
const GRACE_MS = 10_000

const tail = (text: string): string => text.slice(-TAIL)

/** How long a timed-out invocation was given, as an event's `detail` should say it. */
export const minutes = (elapsedMs: number): string => `${Math.round(elapsedMs / 60_000)}m`

export const run = (
    command: string,
    args: readonly string[],
    { cwd, timeoutMs }: { cwd: string; timeoutMs?: number },
): Promise<Ran> =>
    new Promise(resolve => {
        const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] })
        let stdout = ""
        let stderr = ""
        let timedOut = false

        // The timeout is owned here rather than inferred from how long the process ran: a process
        // killed from outside is not a timeout, and one that ignores the first signal must not keep
        // the slot anyway.
        const kill =
            timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                      timedOut = true
                      child.kill("SIGTERM")
                      setTimeout(() => child.kill("SIGKILL"), GRACE_MS).unref()
                  }, timeoutMs)

        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk: string) => {
            stdout = tail(stdout + chunk)
        })
        child.stderr.setEncoding("utf8")
        child.stderr.on("data", (chunk: string) => {
            stderr = tail(stderr + chunk)
        })

        child.on("error", error => {
            clearTimeout(kill)
            resolve({ ok: false, stdout: "", stderr: error.message, timedOut })
        })
        child.on("close", code => {
            clearTimeout(kill)
            resolve({ ok: code === 0 && !timedOut, stdout: stdout.trim(), stderr: stderr.trim(), timedOut })
        })
    })
