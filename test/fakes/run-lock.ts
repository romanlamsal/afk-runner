import type { Holder, RunLock } from "../../src/domain/lock.ts"

export type FakeRunLock = {
    lock: RunLock
    /** Who holds each spec's lock right now, live or not, keyed by the repository and the spec. */
    held: Map<string, Holder>
    /** The holder `pid` stops existing, as a crashed run's process does. */
    die: (pid: number) => void
}

const key = (root: string, spec: number): string => `${root}#${spec}`

/**
 * The run lock in memory. Every process is live until a test says otherwise, which is the one
 * thing the real adapter asks the operating system.
 */
export const createFakeRunLock = ({ heldBy }: { heldBy?: Holder | undefined } = {}): FakeRunLock => {
    const held = new Map<string, Holder>()
    const dead = new Set<number>()
    if (heldBy !== undefined) {
        held.set(key("/repo", 4), heldBy)
    }

    const holder = async (root: string, spec: number): Promise<Holder | undefined> => {
        const named = held.get(key(root, spec))
        return named === undefined || dead.has(named.pid) ? undefined : named
    }

    return {
        held,
        die: pid => {
            dead.add(pid)
        },
        lock: {
            acquire: async (root, spec, self) => {
                const live = await holder(root, spec)
                if (live !== undefined && live.pid !== self.pid) {
                    return { ok: false, holder: live }
                }
                held.set(key(root, spec), self)
                return { ok: true }
            },
            release: async (root, spec, self) => {
                if ((await holder(root, spec))?.pid === self.pid) {
                    held.delete(key(root, spec))
                }
            },
            holder,
        },
    }
}
