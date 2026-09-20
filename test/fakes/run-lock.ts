import type { Holder, RunLock } from "../../src/domain/lock.ts"

export type FakeRunLock = {
    lock: RunLock
    /** Who holds each spec's lock right now, live or not, keyed by the repository and the spec. */
    held: Map<string, Holder>
    /** The holder `pid` stops existing, as a crashed run's process does. */
    die: (pid: number) => void
    /** Every interrupt sent, in order, naming who it was sent to. */
    interrupted: Holder[]
    /** Every holder killed outright, in order. */
    killed: Holder[]
}

export type FakeRunLockSetup = {
    heldBy?: Holder | undefined
    /**
     * What a process sits through, where it sits through anything. `interrupts` is a wedged afk;
     * `everything` is one no signal moves, which no real process is. Anybody unnamed goes on their
     * second interrupt.
     */
    unmoved?: Readonly<Record<number, "interrupts" | "everything">>
}

const key = (root: string, spec: number): string => `${root}#${spec}`

/** A shutting-down afk goes on its second interrupt: the first drains, the second kills (ADR-0016). */
const INTERRUPTS_TO_GO = 2

/**
 * The run lock in memory. Every process is live until a test says otherwise, which is the one
 * thing the real adapter asks the operating system.
 */
export const createFakeRunLock = ({ heldBy, unmoved = {} }: FakeRunLockSetup = {}): FakeRunLock => {
    const held = new Map<string, Holder>()
    const dead = new Set<number>()
    const interrupted: Holder[] = []
    const killed: Holder[] = []
    if (heldBy !== undefined) {
        held.set(key("/repo", 4), heldBy)
    }

    const die = (pid: number): void => {
        dead.add(pid)
    }

    const holder = async (root: string, spec: number): Promise<Holder | undefined> => {
        const named = held.get(key(root, spec))
        return named === undefined || dead.has(named.pid) ? undefined : named
    }

    return {
        held,
        die,
        interrupted,
        killed,
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
            interrupt: async target => {
                interrupted.push(target)
                const count = interrupted.filter(({ pid }) => pid === target.pid).length
                if (count >= INTERRUPTS_TO_GO && unmoved[target.pid] === undefined) {
                    die(target.pid)
                }
            },
            kill: async target => {
                killed.push(target)
                if (unmoved[target.pid] !== "everything") {
                    die(target.pid)
                }
            },
        },
    }
}
