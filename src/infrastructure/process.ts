import { type ChildProcess, spawn } from "node:child_process"

/**
 * Running another program, which is the one thing every adapter in this layer does. It is here
 * rather than in each of them so that "a command afk ran" means the same thing everywhere: output
 * captured, exit code read, and a process that will not start reported as a failure rather than
 * thrown.
 */

/** Every child still running, which is what a second interrupt has to take with it (ADR-0016). */
const live = new Set<ChildProcess>()

/**
 * Every child afk starts is `detached`, so that it leads a process group of its own: a terminal
 * sends its interrupt to the whole foreground group, and an implementer six minutes into its work
 * being killed by the operator's *first* interrupt is the one thing draining exists to prevent
 * (ADR-0016). Registering it here is what lets the second interrupt take it back down.
 *
 * It is not unref'd — the run still waits for what it started.
 */
export const registerChild = (child: ChildProcess): void => {
    live.add(child)
    child.on("error", () => live.delete(child))
    child.on("close", () => live.delete(child))
}

/**
 * Signalling a child afk started means signalling the group it leads, so that what it started in
 * turn — an agent's own subprocesses — goes with it rather than outliving the run.
 */
export const signalGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
    if (child.pid === undefined) {
        return
    }
    try {
        process.kill(-child.pid, signal)
    } catch {
        // No group to signal, because the child is already gone or never got one.
        child.kill(signal)
    }
}

/**
 * Kill everything afk started. This is the second interrupt's whole shutdown: nothing is unwound,
 * because a lifecycle event is written when a step *starts* and the next start dispatches on what
 * that left (ADR-0016).
 */
export const killEveryChild = (): void => {
    for (const child of live) {
        signalGroup(child, "SIGKILL")
    }
}

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

/** What the program said went wrong, preferring what it said on stderr. */
export const complaint = (ran: Ran): string => (ran.stderr === "" ? ran.stdout : ran.stderr)

export const run = (
    command: string,
    args: readonly string[],
    { cwd, timeoutMs }: { cwd: string; timeoutMs?: number },
): Promise<Ran> =>
    new Promise(resolve => {
        const child = spawn(command, [...args], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] })
        registerChild(child)
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
                      signalGroup(child, "SIGTERM")
                      setTimeout(() => signalGroup(child, "SIGKILL"), GRACE_MS).unref()
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
