import { type Holder, type RunLock, refusalToGo, refusalToShare, TAKEOVER } from "../domain/lock.ts"
import type { Operator } from "../domain/operator.ts"

export type TakeOverResult =
    /** The holder is gone, and the lock is nobody's to take. */
    | { outcome: "freed" }
    /** The holder is still there: nobody asked, the operator said no, or it would not go. */
    | { outcome: "refused"; reason: string }

/** The driving port: get a live holder off a spec's run, if the operator wants it off. */
export type TakeOver = (root: string, spec: number, holder: Holder) => Promise<TakeOverResult>

export type TakeOverDeps = {
    lock: RunLock
    operator: Operator
    /** Whether there is a terminal to ask on. Off one there is no offer, only the refusal. */
    interactive: boolean
    /** Waiting reaches out of the process like a clock does, so it arrives as an argument. */
    wait: (ms: number) => Promise<void>
}

/**
 * Taking over a run another afk holds (ADR-0035). Being refused is the right answer for a script
 * and the wrong one for a person who has lost track of a run, so on a terminal the refusal becomes
 * an offer.
 *
 * Accepting sends the holder its own interrupt twice, which is precisely the shutdown it already
 * has: the first drains, the second takes every child it started down and exits. Nothing here knows
 * the holder's children, and nothing needs to. What is left is waiting for the lock to actually
 * free, and killing a holder that will not go, so that a wedged process cannot hold a spec hostage.
 */
export const createTakeOverService = ({ lock, operator, interactive, wait }: TakeOverDeps): TakeOver => {
    /**
     * Whether the lock stopped naming `holder` within `withinMs`. A lock a third afk took in the
     * meantime is not this holder's any more, and is that afk's to refuse over: the only process
     * this takeover ever signals is the one the operator was offered.
     */
    const gone = async (root: string, spec: number, holder: Holder, withinMs: number): Promise<boolean> => {
        for (let waited = 0; ; waited += TAKEOVER.pollMs) {
            if ((await lock.holder(root, spec))?.pid !== holder.pid) {
                return true
            }
            if (waited >= withinMs) {
                return false
            }
            await wait(TAKEOVER.pollMs)
        }
    }

    return async (root, spec, holder) => {
        if (!interactive || !(await operator.takeOver(spec, holder))) {
            return { outcome: "refused", reason: refusalToShare(spec, holder) }
        }

        await lock.interrupt(holder)
        await wait(TAKEOVER.gapMs)
        await lock.interrupt(holder)
        if (await gone(root, spec, holder, TAKEOVER.graceMs)) {
            return { outcome: "freed" }
        }

        await lock.kill(holder)
        if (await gone(root, spec, holder, TAKEOVER.killedMs)) {
            return { outcome: "freed" }
        }
        return { outcome: "refused", reason: refusalToGo(spec, holder) }
    }
}
