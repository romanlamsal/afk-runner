import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { Holder, RunLock } from "../domain/lock.ts"
import { runDirectory, runLockPath } from "../domain/paths.ts"

const HolderSchema = z.object({ pid: z.number().int().positive() })

/**
 * Whether a process exists. Signal 0 delivers nothing and only asks: a process that is there but
 * not ours to signal is still there.
 */
const exists = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error instanceof Error && "code" in error && error.code === "EPERM"
    }
}

/**
 * Who the lock file names, if anybody live. A file that does not parse is treated as no lock at
 * all: the only writer is afk, and a half-written file is a process that died writing it.
 */
const read = async (path: string): Promise<Holder | undefined> => {
    let text: string
    try {
        text = await readFile(path, "utf8")
    } catch {
        return undefined
    }
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        return undefined
    }
    const parsed = HolderSchema.safeParse(json)
    return parsed.success && exists(parsed.data.pid) ? parsed.data : undefined
}

/** A signal to a process that no longer exists has nothing left to do, which is what it was sent for. */
const signal = (pid: number, name: NodeJS.Signals): void => {
    try {
        process.kill(pid, name)
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
            throw error
        }
    }
}

const isAlreadyThere = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "EEXIST"

/**
 * The run lock as a file in the run directory, naming the holder's pid (ADR-0036). Written with
 * `wx`, so that two processes racing for an absent lock cannot both believe they won it.
 */
export const createFileRunLock = (): RunLock => ({
    acquire: async (root, spec, self) => {
        const path = join(root, runLockPath(spec))
        await mkdir(join(root, runDirectory(spec)), { recursive: true })

        // Twice at most: a lock left by a dead holder is taken away and the write is tried again, and
        // losing that second race to another process is losing it to a live holder.
        for (let tries = 0; tries < 2; tries += 1) {
            try {
                await writeFile(path, `${JSON.stringify(self)}\n`, { encoding: "utf8", flag: "wx" })
                return { ok: true }
            } catch (error) {
                if (!isAlreadyThere(error)) {
                    throw error
                }
            }
            const holder = await read(path)
            if (holder?.pid === self.pid) {
                return { ok: true }
            }
            if (holder !== undefined) {
                return { ok: false, holder }
            }
            await rm(path, { force: true })
        }

        // A lock that kept reappearing and kept naming nobody live: something other than afk is
        // writing it, and that is not a race this adapter can settle.
        throw new Error(`${runLockPath(spec)} could not be taken`)
    },
    release: async (root, spec, self) => {
        const path = join(root, runLockPath(spec))
        if ((await read(path))?.pid === self.pid) {
            await rm(path, { force: true })
        }
    },
    holder: async (root, spec) => read(join(root, runLockPath(spec))),
    interrupt: async ({ pid }) => signal(pid, "SIGINT"),
    kill: async ({ pid }) => signal(pid, "SIGKILL"),
})
