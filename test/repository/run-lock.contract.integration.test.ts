import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { createFileRunLock } from "../../src/repository/run-lock.ts"
import { describeRunLockContract } from "../contract/run-lock.ts"

/**
 * The real half of the run lock's contract: the lock file in a throwaway directory, and real
 * processes behind every pid — this one, one kept alive for the suite, and one that has exited.
 */
const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { stdio: "ignore" })

afterAll(() => {
    sleeper.kill("SIGKILL")
})

const exited = async (): Promise<number> => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
    const pid = child.pid
    await once(child, "exit")
    if (pid === undefined) {
        throw new Error("a process to outlive could not be started")
    }
    return pid
}

describeRunLockContract("the run lock file", async () => {
    const live = sleeper.pid
    if (live === undefined) {
        throw new Error("a live process to hold the lock could not be started")
    }
    return {
        lock: createFileRunLock(),
        root: await mkdtemp(join(tmpdir(), "afk-run-lock-")),
        spec: 4,
        self: { pid: process.pid },
        live: { pid: live },
        dead: { pid: await exited() },
    }
})
